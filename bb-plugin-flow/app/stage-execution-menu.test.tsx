// @vitest-environment jsdom
// Таблица этапов двух видов: агентские и скрипты. Меню исполнения агентского этапа —
// «Субагент · Workflow · Виджет»; меню скрипта — запуск, наборы, шаги Flow и свой файл.
// Под таблицей — «Добавить этап», «Добавить скрипт» и «Удалить flow».
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { builtinAutomationStage } from "../core/automation-run";
import { actionStage, automationStage, builtinStage } from "../lib/stage-constants";
import type { FlowSettings, flowSettingsRpcContract, StageCatalog, StageExecutor, WorkStage } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const reviewer: StageExecutor = { id: "agent:reviewer", kind: "agent", name: "reviewer", provider: "claude-code" };

const chain = (id: string, steps: string[]): WorkStage => ({ ...builtinAutomationStage([]), id, name: `Chain ${id}`, automation: { source: "flow", steps: steps as never } });

const STAGES: WorkStage[] = [
  builtinStage("questions", []),
  { id: "spec", kind: "skill", skill: "spec", name: "Spec", executors: [] },
  { id: "review", kind: "skill", skill: "code-review", name: "Review", executors: [reviewer] },
  chain("commit", ["git.commit"]),
  { ...actionStage([]), automation: { source: "flow", steps: ["bb.archive"] } },
  automationStage({ id: "release", name: "Release" }),
];

const settings = (stages: WorkStage[] = STAGES, extra: Partial<FlowSettings> = {}): FlowSettings => ({
  flows: [
    { id: "default", name: "Default", stages },
    { id: "quick", name: "Quick", stages: [] },
  ],
  minButtonWidth: 170,
  ...extra,
});

const catalog: StageCatalog = {
  skills: [{ name: "spec" }, { name: "code-review" }],
  executors: [
    { ...reviewer, origin: { kind: "own" } },
    { id: "agent:scout", kind: "agent", name: "scout", provider: "claude-code", origin: { kind: "project", project: "bb-plugins" } },
    { id: "agent:cm:critic", kind: "agent", name: "cm:critic", provider: "claude-code", origin: { kind: "plugin", plugin: "cm" } },
    { id: "agent:codex/reviewer", kind: "agent", name: "reviewer", provider: "codex" },
    { id: "workflow:DEV1", kind: "workflow", name: "DEV1" },
  ],
};

const open = (initial: FlowSettings = settings(), options: { save?: (input: unknown) => unknown; language?: string } = {}) => {
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
  return renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
    rpc: { getFlowSettings: () => initial, saveFlowSettings: options.save ?? ((input: unknown) => input), getStageCatalog: () => catalog, getRootSkill: () => null } as never,
    settings: { language: options.language ?? "Русский" },
  });
};
type Slot = ReturnType<typeof open>;

const lastSaved = (slot: Slot) => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;
const savedStage = (slot: Slot, n: number) => lastSaved(slot)?.flows[0]?.stages[n - 1];
const row = async (slot: Slot, n: number) => within(await slot.findByRole("row", { name: `Этап ${n}` }));

/** Плюс исполнения строки `n` и меню, которое он открыл. */
const openMenu = async (slot: Slot, n: number) => {
  fireEvent.click((await row(slot, n)).getByRole("button", { name: "Исполнение этапа" }));
  return within(await slot.findByRole("menu", { name: "Исполнение" }));
};

/** Сегмент Radix Tabs переключается нажатием кнопки мыши, а не щелчком. */
const pickTab = (menu: ReturnType<typeof within>, name: string) => fireEvent.mouseDown(menu.getByRole("tab", { name }), { button: 0 });

const groupItems = (menu: ReturnType<typeof within>, group: string) =>
  [...menu.getByRole("group", { name: group }).querySelectorAll('[role^="menuitem"]')].map((item) => item.textContent);

describe("строка этапа", () => {
  it("виджет — тег вида с крестом, без надписи охвата", async () => {
    const slot = open();
    const first = await row(slot, 1);
    expect(first.getByRole("button", { name: "Убрать Вопросы" })).toBeTruthy();
    expect(first.queryByText(/этапы \d/)).toBeNull();
  });

  it("у Action перед шагами — метка «Кнопкой владельца», у этапа со шагами Flow её нет", async () => {
    const slot = open();
    expect((await row(slot, 5)).getByText("Кнопкой владельца")).toBeTruthy();
    expect((await row(slot, 4)).queryByText("Кнопкой владельца")).toBeNull();
  });

  it("у автоматизации Automations плюса исполнения нет", async () => {
    const slot = open();
    expect((await row(slot, 6)).queryByRole("button", { name: "Исполнение этапа" })).toBeNull();
  });
});

describe("меню исполнения", () => {
  it("у агентского этапа сегменты Субагент, Workflow, Виджет; у виджета меню открывается на «Виджете»", async () => {
    const slot = open();
    const agents = await openMenu(slot, 3);
    expect(agents.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Субагент", "Workflow", "Виджет"]);
    expect(agents.getByRole("tab", { name: "Субагент" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click((await row(slot, 3)).getByRole("button", { name: "Исполнение этапа" }));
    const widget = await openMenu(slot, 1);
    expect(widget.getByRole("tab", { name: "Виджет" }).getAttribute("aria-selected")).toBe("true");
  });

  it("в меню агентского этапа нет шагов скрипта и запуска", async () => {
    const menu = await openMenu(open(), 2);
    for (const tab of ["Субагент", "Workflow", "Виджет"]) {
      pickTab(menu, tab);
      expect(menu.queryByRole("menuitem", { name: "Commit" })).toBeNull();
      expect(menu.queryByRole("tablist", { name: "Запуск" })).toBeNull();
    }
  });

  it("в меню скрипта нет сегментов, агентов и виджетов — только запуск и шаги", async () => {
    const menu = await openMenu(open(), 4);
    expect(menu.queryAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Сам", "Кнопкой владельца"]);
    expect(menu.queryByRole("group", { name: "Виджеты" })).toBeNull();
    expect(menu.queryByText("scout")).toBeNull();
    expect(menu.getByRole("menuitem", { name: "Открыть PR" })).toBeTruthy();
  });

  it("«Субагент» — только агенты группами по источнику, «Workflow» — только workflow", async () => {
    const slot = open();
    const menu = await openMenu(slot, 2);
    expect(menu.getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Мои агенты", "Проект · bb-plugins", "Плагин · cm", "Codex"]);
    expect(menu.queryByText("DEV1")).toBeNull();
    pickTab(menu, "Workflow");
    expect(groupItems(menu, "Workflow")).toEqual(["DEV1"]);
    expect(menu.queryByText("scout")).toBeNull();
  });

  it("одноимённые агенты Claude Code и Codex отмечаются и ставятся каждый своим id", async () => {
    const slot = open();
    const menu = await openMenu(slot, 3);
    const own = within(menu.getByRole("group", { name: "Мои агенты" })).getByRole("menuitemcheckbox", { name: /reviewer/ });
    const codex = within(menu.getByRole("group", { name: "Codex" })).getByRole("menuitemcheckbox", { name: /reviewer/ });
    expect([own.getAttribute("aria-checked"), codex.getAttribute("aria-checked")]).toEqual(["true", "false"]);
    fireEvent.click(codex);
    await vi.waitFor(() => expect(savedStage(slot, 3)?.executors.map((e) => e.id)).toEqual(["agent:reviewer", "agent:codex/reviewer"]));
  });

  it("агент на виджете делает этап навыком вида с этим агентом и видимым названием", async () => {
    const slot = open();
    const menu = await openMenu(slot, 1);
    pickTab(menu, "Субагент");
    fireEvent.click(menu.getByRole("menuitemcheckbox", { name: /scout/ }));
    await vi.waitFor(() =>
      expect(savedStage(slot, 1)).toEqual({ id: "questions", kind: "skill", skill: "flow-questions", name: "Вопросы", executors: [{ ...catalog.executors[1] }] }),
    );
  });
});

describe("меню скрипта", () => {
  it("«Кнопкой владельца» делает этап Action, «Сам» — возвращает; шаги остаются", async () => {
    const slot = open();
    const menu = await openMenu(slot, 4);
    pickTab(within(menu.getByRole("tablist", { name: "Запуск" }).parentElement!), "Кнопкой владельца");
    await vi.waitFor(() => expect(savedStage(slot, 4)).toMatchObject({ kind: "action", automation: { steps: ["git.commit"] } }));
    pickTab(within(menu.getByRole("tablist", { name: "Запуск" }).parentElement!), "Сам");
    await vi.waitFor(() => expect(savedStage(slot, 4)).toMatchObject({ kind: "skill", automation: { steps: ["git.commit"] } }));
  });

  it("виджет ставит вид, оставляет свой навык и снимает исполнителей", async () => {
    const slot = open();
    const menu = await openMenu(slot, 3);
    pickTab(menu, "Виджет");
    expect(groupItems(menu, "Виджеты").map((text) => text?.replace(/flow-.*/, ""))).toEqual(["Вопросы", "Критерии", "Выбор этапов", "Демонстрация"]);
    fireEvent.click(menu.getByRole("menuitemradio", { name: /Критерии/ }));
    await vi.waitFor(() => expect(savedStage(slot, 3)).toEqual({ id: "review", kind: "criteria", skill: "code-review", name: "Review", executors: [] }));
  });

  it("у виджета переключателя запуска нет, его вид отмечен", async () => {
    const slot = open();
    const menu = await openMenu(slot, 1);
    expect(menu.queryByRole("tablist", { name: "Запуск" })).toBeNull();
    expect(menu.getByRole("menuitemradio", { name: /Вопросы/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("крест виджета оставляет этап навыком его вида с видимым названием", async () => {
    const slot = open();
    fireEvent.click((await row(slot, 1)).getByRole("button", { name: "Убрать Вопросы" }));
    await vi.waitFor(() => expect(savedStage(slot, 1)).toEqual({ id: "questions", kind: "skill", skill: "flow-questions", name: "Вопросы", executors: [] }));
  });

  it("пока PR никто не открывает, шаги по PR выбрать нельзя; за этапом, открывающим PR, — можно", async () => {
    const before = await openMenu(open(), 4);
    expect(before.getByRole("menuitem", { name: "Смёрджить PR" }).getAttribute("aria-disabled")).toBe("true");
    expect(before.getByRole("menuitem", { name: "Открыть PR" }).getAttribute("aria-disabled")).toBe("false");
    cleanup();
    const after = await openMenu(open(settings([chain("open", ["git.create-pr"]), chain("land", [])])), 2);
    expect(after.getByRole("menuitem", { name: "Смёрджить PR" }).getAttribute("aria-disabled")).toBe("false");
    expect(after.getByRole("menuitem", { name: "Открыть PR" }).getAttribute("aria-disabled")).toBe("false");
  });

  it("стоящий шаг выбрать нельзя", async () => {
    const menu = await openMenu(open(), 4);
    expect(menu.getByRole("menuitem", { name: "Commit" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("серверный отказ сохранения показан как есть", async () => {
    const slot = open(settings(), {
      save: () => {
        throw new Error("kv is unavailable");
      },
    });
    fireEvent.click((await openMenu(slot, 4)).getByRole("menuitem", { name: "Открыть PR" }));
    expect((await slot.findByRole("alert")).textContent).toContain("kv is unavailable");
  });
});

describe("скрипт файлом", () => {
  const pickFile = (slot: Slot, file: File) => {
    const input = slot.container.ownerDocument.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error("no file input");
    fireEvent.change(input, { target: { files: [file] } });
  };

  it("выбранный файл встаёт шагом с новым id, именем файла и содержимым", async () => {
    const id = "7f0c3a2e-0000-4000-8000-000000000001";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(id);
    const slot = open();
    fireEvent.click((await openMenu(slot, 4)).getByRole("menuitem", { name: "Добавить скрипт…" }));
    pickFile(slot, new File(["#!/bin/sh\necho deployed"], "deploy.sh"));
    await vi.waitFor(() =>
      expect(savedStage(slot, 4)?.automation).toEqual({ source: "flow", steps: ["git.commit", `script:${id}`], scripts: [{ id, name: "deploy.sh", content: "#!/bin/sh\necho deployed" }] }),
    );
  });

  it("слишком большой файл не добавляется, в меню — причина", async () => {
    const slot = open();
    fireEvent.click((await openMenu(slot, 4)).getByRole("menuitem", { name: "Добавить скрипт…" }));
    pickFile(slot, new File(["x".repeat(200_001)], "big.sh"));
    expect(await slot.findByText("Скрипт больше 200 000 символов — не добавлен")).toBeTruthy();
    expect(slot.rpcCalls.some((c) => c.method === "saveFlowSettings")).toBe(false);
  });

  it("файл, заведомо больше предела по размеру, отклоняется без чтения содержимого", async () => {
    const slot = open();
    fireEvent.click((await openMenu(slot, 4)).getByRole("menuitem", { name: "Добавить скрипт…" }));
    const huge = new File(["x"], "huge.bin");
    Object.defineProperty(huge, "size", { value: 5_000_000_000 });
    const text = vi.spyOn(huge, "text");
    pickFile(slot, huge);
    expect(await slot.findByText("Скрипт больше 200 000 символов — не добавлен")).toBeTruthy();
    expect(text).not.toHaveBeenCalled();
  });
});

describe("сохранённые наборы в меню скрипта", () => {
  const withSet = settings([...STAGES, chain("empty", [])], { automationSets: [{ steps: ["git.create-pr", "git.merge"] }] });

  it("у скрипта без шагов набор — строкой своих шагов; выбор ставит шаги", async () => {
    const slot = open(withSet);
    const menu = await openMenu(slot, 7);
    fireEvent.click(within(menu.getByRole("group", { name: "Сохранённые наборы" })).getByRole("menuitem", { name: "Открыть PR · Смёрджить PR" }));
    await vi.waitFor(() => expect(savedStage(slot, 7)?.automation).toEqual({ source: "flow", steps: ["git.create-pr", "git.merge"] }));
  });

  it("у этапа со шагами наборов в меню нет", async () => {
    const menu = await openMenu(open(withSet), 4);
    expect(menu.queryByRole("group", { name: "Сохранённые наборы" })).toBeNull();
  });

  it("набор убирается крестом", async () => {
    const slot = open(withSet);
    const menu = await openMenu(slot, 7);
    fireEvent.click(menu.getByRole("button", { name: "Убрать набор Открыть PR · Смёрджить PR" }));
    await vi.waitFor(() => expect(lastSaved(slot)?.automationSets).toEqual([]));
  });
});

describe("под таблицей", () => {
  it("«Добавить этап», «Добавить скрипт» и «Удалить flow» стоят в одной строке под таблицей, полосы кнопок видов нет", async () => {
    const slot = open();
    const add = await slot.findByRole("button", { name: "Добавить этап" });
    const script = slot.getByRole("button", { name: "Добавить скрипт" });
    const remove = slot.getByRole("button", { name: "Удалить flow Default" });
    const line = [...slot.container.querySelectorAll<HTMLElement>("div")].filter((el) => el.contains(add) && el.contains(remove)).at(-1)!;
    expect(line.contains(script)).toBe(true);
    expect(add.compareDocumentPosition(script) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.className).toMatch(/\bflex\b/);
    expect(line.className).not.toMatch(/flex-col/);
    for (const name of ["Добавить этап Навык", "Добавить этап Вопросы", "Добавить этап Action", "Автоматизация"]) expect(slot.queryByRole("button", { name })).toBeNull();
  });

  it("«Добавить этап» дописывает «Новый этап» без навыка и исполнителей", async () => {
    const slot = open();
    fireEvent.click(await slot.findByRole("button", { name: "Добавить этап" }));
    await vi.waitFor(() => expect(lastSaved(slot)?.flows[0]?.stages.at(-1)).toMatchObject({ kind: "skill", skill: "", name: "Новый этап", executors: [] }));
    expect(lastSaved(slot)?.flows[0]?.stages.at(-1)?.automation).toBeUndefined();
  });

  it("«Добавить скрипт» дописывает скрипт без шагов, и его меню — меню скрипта", async () => {
    const slot = open(settings([]));
    fireEvent.click(await slot.findByRole("button", { name: "Добавить скрипт" }));
    await vi.waitFor(() => expect(savedStage(slot, 1)).toMatchObject({ kind: "skill", skill: "", executors: [], automation: { source: "flow", steps: [] } }));
    const menu = await openMenu(slot, 1);
    expect(menu.queryByRole("tab", { name: "Субагент" })).toBeNull();
    expect(menu.getByRole("menuitem", { name: "Commit" })).toBeTruthy();
  });

  it("виджет на новом этапе подписывает его своим видом", async () => {
    const slot = open(settings([]));
    fireEvent.click(await slot.findByRole("button", { name: "Добавить этап" }));
    const menu = await openMenu(slot, 1);
    pickTab(menu, "Виджет");
    fireEvent.click(menu.getByRole("menuitemradio", { name: /Демонстрация/ }));
    await vi.waitFor(() => expect(savedStage(slot, 1)).toMatchObject({ kind: "demo", skill: "", name: builtinStage("demo", []).name }));
  });

  it("шаг на новом скрипте подписывает его своими шагами, на названном — имя остаётся", async () => {
    const slot = open(settings([]));
    fireEvent.click(await slot.findByRole("button", { name: "Добавить скрипт" }));
    const menu = await openMenu(slot, 1);
    fireEvent.click(menu.getByRole("menuitem", { name: "Commit" }));
    await vi.waitFor(() => expect(savedStage(slot, 1)).toMatchObject({ name: "Commit", automation: { steps: ["git.commit"] } }));
    fireEvent.click((await openMenu(slot, 1)).getByRole("menuitem", { name: "Открыть PR" }));
    await vi.waitFor(() => expect(savedStage(slot, 1)).toMatchObject({ name: "Commit", automation: { steps: ["git.commit", "git.create-pr"] } }));
  });
});

describe("по-английски", () => {
  it("страница, меню агентского этапа и меню скрипта без кириллицы — в тексте и в атрибутах", async () => {
    const slot = open(settings(), { language: "English" });
    const second = within(await slot.findByRole("row", { name: "Stage 2" }));
    fireEvent.click(second.getByRole("button", { name: "Stage execution" }));
    const menu = within(await slot.findByRole("menu", { name: "Execution" }));
    expect(menu.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Subagent", "Workflow", "Widget"]);
    expect(slot.getByRole("button", { name: "Add script" })).toBeTruthy();
    fireEvent.click(second.getByRole("button", { name: "Stage execution" }));
    fireEvent.click(within(await slot.findByRole("row", { name: "Stage 4" })).getByRole("button", { name: "Stage execution" }));
    const script = within(await slot.findByRole("menu", { name: "Execution" }));
    expect(script.getByRole("tablist", { name: "Run" })).toBeTruthy();
    const root = slot.container.ownerDocument.body;
    const texts = [root.textContent ?? "", ...[...root.querySelectorAll("[aria-label],[placeholder],[title]")].flatMap((el) => ["aria-label", "placeholder", "title"].map((a) => el.getAttribute(a) ?? ""))];
    expect(texts.filter((text) => /[А-Яа-яЁё]/.test(text))).toEqual([]);
  });
});
