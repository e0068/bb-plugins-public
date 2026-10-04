// @vitest-environment jsdom
// Навык этапа — вкладка «Навык» в меню плюса и чип «Навык: имя» в ячейке исполнения, как агенты и workflow.
// Чипы с файлом — навык, виджет, агент, workflow, свой скрипт — по клику открывают файл в правой панели bb.
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { automationStage, builtinStage } from "../lib/stage-constants";
import type { FlowSettings, flowSettingsRpcContract, SkillFile, StageCatalog, StageExecutor, WorkStage } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const reviewer: StageExecutor = { id: "agent:reviewer", kind: "agent", name: "reviewer", provider: "claude-code" };
const dev: StageExecutor = { id: "workflow:DEV1", kind: "workflow", name: "DEV1" };
const script = { id: "s1", name: "deploy.sh", content: "echo hi\n" };

const STAGES: WorkStage[] = [
  builtinStage("questions", []),
  { id: "spec", kind: "skill", skill: "spec", name: "Spec", executors: [] },
  { id: "review", kind: "skill", skill: "code-review", name: "Review", executors: [reviewer, dev] },
  { ...builtinStage("demo", []), skill: "my-demo" },
  { id: "ship", kind: "skill", skill: "", name: "Ship", executors: [], automation: { source: "flow", steps: ["script:s1"], scripts: [script] } },
  automationStage({ id: "release", name: "Release" }),
  { id: "task", kind: "skill", skill: "task-flow", name: "Task", executors: [] },
];

const CATALOG: StageCatalog = {
  skills: [
    { name: "code-review", origin: { kind: "own" } },
    { name: "figma:figma-use", description: "Figma", origin: { kind: "plugin", plugin: "figma", provider: "claude-code" } },
    { name: "flow-demo", origin: { kind: "plugin", plugin: "flow" } },
    { name: "flow-questions", origin: { kind: "plugin", plugin: "flow" } },
    { name: "my-demo", origin: { kind: "own" } },
    { name: "my-questions", origin: { kind: "own" } },
    { name: "release-notes", origin: { kind: "project" } },
    { name: "spec", origin: { kind: "own" } },
  ],
  executors: [
    { ...reviewer, origin: { kind: "own" } },
    { ...dev, origin: { kind: "own" } },
  ],
};

type Files = { skill?: (input: { name: string }) => SkillFile; executor?: (input: { id: string }) => SkillFile; script?: (input: typeof script) => SkillFile };

const at = (path: string): SkillFile => ({ hostId: "host_local", path });

const open = ({ catalog = CATALOG, language = "Русский", files = {} }: { catalog?: StageCatalog; language?: string; files?: Files } = {}) => {
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
  return renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
    rpc: {
      getFlowSettings: () => ({ flows: [{ id: "default", name: "Default", stages: STAGES }], minButtonWidth: 170 }),
      saveFlowSettings: (input: unknown) => input,
      getStageCatalog: () => catalog,
      getRootSkill: () => null,
      getSkillFile: files.skill ?? (({ name }: { name: string }) => at(`/skills/${name}/SKILL.md`)),
      getExecutorFile: files.executor ?? (({ id }: { id: string }) => at(`/executors/${id}`)),
      getScriptFile: files.script ?? ((s: typeof script) => at(`/tmp/${s.name}`)),
    } as never,
    settings: { language },
  });
};
type Slot = ReturnType<typeof open>;

const savedStage = (slot: Slot, n: number) => ([...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined)?.flows[0]?.stages[n - 1];
const row = async (slot: Slot, n: number) => within(await slot.findByRole("row", { name: `Этап ${n}` }));

const openMenu = async (slot: Slot, n: number) => {
  fireEvent.click((await row(slot, n)).getByRole("button", { name: "Исполнение этапа" }));
  return within(await slot.findByRole("menu", { name: "Исполнение" }));
};

/** Меню строки `n`, переключённое на вкладку «Навык». */
const skillTab = async (slot: Slot, n: number) => {
  const menu = await openMenu(slot, n);
  fireEvent.mouseDown(menu.getByRole("tab", { name: "Навык" }), { button: 0 });
  return menu;
};

const previews = (slot: Slot) => slot.navigateCalls.filter((c) => c.method === "experimental_openFilePreview");

describe("навык через плюс", () => {

  it("на вкладке «Навык» навыки группами по источнику, у плагина провайдера — имя без префикса", async () => {
    const menu = await skillTab(open(), 7);
    const groups = menu.getAllByRole("group").map((g) => g.getAttribute("aria-label"));
    expect(groups).toEqual(["Мои навыки", "Навыки проекта", "Плагин bb · flow", "Claude Code · figma"]);
    const figma = within(menu.getByRole("group", { name: "Claude Code · figma" }));
    expect(figma.getByRole("menuitemradio").textContent).toContain("figma-use");
    expect(figma.getByRole("menuitemradio").textContent).not.toContain("figma:");
  });

  it("выбор навыка сохраняет полное имя и закрывает меню", async () => {
    const slot = open();
    fireEvent.click((await skillTab(slot, 7)).getByRole("menuitemradio", { name: /figma-use/ }));
    await vi.waitFor(() => expect(savedStage(slot, 7)).toMatchObject({ skill: "figma:figma-use" }));
    await vi.waitFor(() => expect(slot.queryByRole("menu", { name: "Исполнение" })).toBeNull());
  });

  it("выбранный навык отмечен, поиск сужает список", async () => {
    const slot = open();
    const menu = await skillTab(slot, 2);
    expect(menu.getByRole("menuitemradio", { name: /^spec/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.change(menu.getByRole("textbox", { name: "Найти навык" }), { target: { value: "rel" } });
    expect(menu.getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual(["release-notes"]);
  });

  it("свой навык по имени ставится Enter в поиске", async () => {
    const slot = open();
    const menu = await skillTab(slot, 2);
    const search = menu.getByRole("textbox", { name: "Найти навык" });
    fireEvent.change(search, { target: { value: "my-own" } });
    fireEvent.keyDown(search, { key: "Enter" });
    await vi.waitFor(() => expect(savedStage(slot, 2)).toMatchObject({ skill: "my-own" }));
  });

  it("у автоматизации Automations плюс открывает только навыки, выбор не трогает её название", async () => {
    const slot = open();
    const menu = await openMenu(slot, 6);
    expect(menu.queryAllByRole("tab")).toEqual([]);
    fireEvent.click(menu.getByRole("menuitemradio", { name: /^spec/ }));
    await vi.waitFor(() => expect(savedStage(slot, 6)).toMatchObject({ skill: "spec", name: "Release", automation: { id: "release" } }));
  });

  it("у скрипта вкладки «Навык» нет", async () => {
    const menu = await openMenu(open(), 5);
    expect(menu.queryByRole("tab", { name: "Навык" })).toBeNull();
  });
});

describe("чип навыка", () => {
  it("навык стоит чипом «Навык: имя», колонки и поля навыка в таблице нет", async () => {
    const slot = open();
    expect((await row(slot, 2)).getByRole("button", { name: "Навык: spec" })).toBeTruthy();
    expect(slot.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["№", "Название", "Исполнение", "Шаблон", "Удалить"]);
    expect(slot.queryByRole("combobox")).toBeNull();
  });

  it("в английском интерфейсе чип подписан «Skill: имя»", async () => {
    const slot = open({ language: "English" });
    expect(await slot.findByRole("button", { name: "Skill: spec" })).toBeTruthy();
  });

  it("крестик снимает навык, название этапа остаётся", async () => {
    const slot = open();
    fireEvent.click((await row(slot, 2)).getByRole("button", { name: "Убрать навык spec" }));
    await vi.waitFor(() => expect(savedStage(slot, 2)).toMatchObject({ skill: "", name: "Spec" }));
  });

  it("навыка нет в каталоге — чипа нет; каталог не прочитан — чип по имени как есть", async () => {
    expect((await row(open(), 7)).queryByRole("button", { name: /Навык:/ })).toBeNull();
    cleanup();
    expect((await row(open({ catalog: { skills: [], executors: [] } }), 7)).getByRole("button", { name: "Навык: task-flow" })).toBeTruthy();
  });
});

describe("клик по чипу открывает файл в правой панели", () => {
  it("чип навыка — SKILL.md навыка", async () => {
    const slot = open();
    fireEvent.click((await row(slot, 2)).getByRole("button", { name: "Навык: spec" }));
    await vi.waitFor(() => expect(previews(slot).at(-1)).toMatchObject({ options: { target: { kind: "host", hostId: "host_local", path: "/skills/spec/SKILL.md" } } }));
  });

  it("чип агента и чип workflow — файл исполнителя по его id", async () => {
    const slot = open();
    const review = await row(slot, 3);
    fireEvent.click(review.getByRole("button", { name: /^reviewer/ }));
    await vi.waitFor(() => expect(previews(slot).at(-1)).toMatchObject({ options: { target: { path: "/executors/agent:reviewer" } } }));
    fireEvent.click(review.getByRole("button", { name: /^DEV1/ }));
    await vi.waitFor(() => expect(previews(slot).at(-1)).toMatchObject({ options: { target: { path: "/executors/workflow:DEV1" } } }));
  });

  it("шаг своего скрипта — файл с текстом скрипта", async () => {
    const slot = open();
    fireEvent.click((await row(slot, 5)).getByRole("button", { name: "deploy.sh" }));
    await vi.waitFor(() => expect(previews(slot).at(-1)).toMatchObject({ options: { target: { path: "/tmp/deploy.sh" } } }));
    expect(slot.rpcCalls.find((c) => c.method === "getScriptFile")?.input).toEqual(script);
  });

  it("файл не нашёлся — надпись в строке, превью не открывается", async () => {
    const slot = open({ files: { executor: () => null } });
    fireEvent.click((await row(slot, 3)).getByRole("button", { name: /^reviewer/ }));
    expect(await (await row(slot, 3)).findByText("Файл не найден")).toBeTruthy();
    expect(previews(slot)).toEqual([]);
  });

  it("Main Agent файла не имеет и не кликается", async () => {
    expect((await row(open(), 2)).queryByRole("button", { name: "Main Agent" })).toBeNull();
  });
});
