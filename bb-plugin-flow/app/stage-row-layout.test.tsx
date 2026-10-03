// @vitest-environment jsdom
// Строка этапа: иконка в поле названия, исполнение перед навыком, стрелка файла навыка левее крестика,
// у скрипта нет навыка, шаги скрипта — через шеврон, исполнители — через «или», Main Agent — тегом по умолчанию.
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { builtinAutomationStage } from "../core/automation-run";
import { builtinStage } from "../lib/stage-constants";
import type { FlowSettings, flowSettingsRpcContract, StageCatalog, StageExecutor, WorkStage } from "../shared/contract";
import { AUTOMATION_ICON, KIND_ICONS, SKILL_ICON } from "./stage-icons";

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const reviewer: StageExecutor = { id: "agent:reviewer", kind: "agent", name: "reviewer", provider: "claude-code" };
const dev: StageExecutor = { id: "workflow:DEV1", kind: "workflow", name: "DEV1" };

const STAGES: WorkStage[] = [
  builtinStage("questions", []),
  { id: "spec", kind: "skill", skill: "spec", name: "Spec", executors: [] },
  { id: "review", kind: "skill", skill: "code-review", name: "Review", executors: [reviewer, dev] },
  { ...builtinAutomationStage([]), id: "ship", name: "Ship", automation: { source: "flow", steps: ["git.commit", "git.create-pr", "bb.archive"] } },
];

const catalog: StageCatalog = { skills: [{ name: "spec" }, { name: "code-review" }], executors: [reviewer, dev] };

const open = (stages: WorkStage[] = STAGES) => {
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
  const settings: FlowSettings = { flows: [{ id: "default", name: "Default", stages }], minButtonWidth: 170 };
  return renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog, getRootSkill: () => null } as never,
    settings: { language: "Русский" },
  });
};
type Slot = ReturnType<typeof open>;

const rowOf = (slot: Slot, n: number) => slot.findByRole("row", { name: `Этап ${n}` });
const cellsOf = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>('[role="cell"]')];
const savedStage = (slot: Slot, n: number) =>
  ([...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined)?.flows[0]?.stages[n - 1];

describe("иконка этапа в поле названия", () => {
  it.each([
    [1, KIND_ICONS.questions],
    [2, SKILL_ICON],
    [4, AUTOMATION_ICON],
  ])("в строке %i иконка стоит в клетке названия, а в клетке номера её нет", async (n, icon) => {
    const row = await rowOf(open(), n);
    const [number, name] = cellsOf(row);
    expect(number!.querySelector(`[data-icon="${icon}"]`)).toBeNull();
    expect(name!.querySelector("input")).not.toBeNull();
    expect(name!.querySelector(`[data-icon="${icon}"]`)).not.toBeNull();
  });

  it("иконка в поле названия по-прежнему открывает выбор иконки", async () => {
    const slot = open();
    const row = within(await rowOf(slot, 2));
    fireEvent.click(row.getByRole("button", { name: /иконк/i }));
    expect(await slot.findByRole("listbox", { name: /иконк/i })).toBeTruthy();
  });
  it("иконка названия не заводит свой слой: подборка иконок строки выше не уходит под иконки строк ниже", async () => {
    const row = await rowOf(open(), 2);
    const [, name] = cellsOf(row);
    const picker = within(name!).getByRole("button", { name: /иконк/i });
    const layers: string[] = [];
    for (let el = picker.parentElement; el !== null && el !== name; el = el.parentElement) layers.push(...[...el.classList].filter((c) => /^z-/.test(c)));
    expect(layers).toEqual([]);
  });
});

describe("исполнение перед навыком", () => {
  it("колонки идут по порядку: название, исполнение, навык, шаблон, удалить", async () => {
    const slot = open();
    await rowOf(slot, 1);
    expect(slot.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["№", "Название", "Исполнение", "Навык", "Шаблон", "Удалить"]);
  });

  it("клетки строки идут: название, исполнение, навык", async () => {
    const row = await rowOf(open(), 2);
    const [, name, execution, skill] = cellsOf(row);
    expect(within(name!).getByRole("textbox", { name: "Название этапа 2" })).toBeTruthy();
    expect(within(execution!).getByRole("button", { name: "Исполнение этапа" })).toBeTruthy();
    expect(within(skill!).getByRole("combobox", { name: "Навык этапа 2" })).toBeTruthy();
  });

  it("в поле навыка стрелка открытия файла стоит перед крестиком очистки", async () => {
    const row = within(await rowOf(open(), 2));
    const arrow = row.getByRole("button", { name: "Открыть навык spec" });
    const cross = row.getByRole("button", { name: "Очистить навык" });
    expect(arrow.compareDocumentPosition(cross) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("скрипт", () => {
  it("у этапа-скрипта нет поля навыка", async () => {
    const row = within(await rowOf(open(), 4));
    expect(row.queryByRole("combobox", { name: "Навык этапа 4" })).toBeNull();
  });

  it("между шагами скрипта стоит шеврон вправо — по одному между соседними", async () => {
    const row = await rowOf(open(), 4);
    expect(row.querySelectorAll('[data-icon="ChevronRight"]')).toHaveLength(2);
  });
});

describe("плюс исполнения", () => {
  it.each([3, 4])("в строке %i плюс стоит после последнего тега", async (n) => {
    const row = await rowOf(open(), n);
    const [, , execution] = cellsOf(row);
    const plus = within(execution!).getByRole("button", { name: "Исполнение этапа" });
    const tags = [...execution!.querySelectorAll<HTMLElement>("span.rounded-md, li")].filter((tag) => !tag.contains(plus) && tag.getAttribute("aria-hidden") !== "true");
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.every((tag) => tag.compareDocumentPosition(plus) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });
});

describe("исполнители и Main Agent", () => {
  it("между Main Agent, агентом и workflow стоит «или»", async () => {
    const row = within(await rowOf(open(), 3));
    expect(row.getByText("Main Agent")).toBeTruthy();
    expect(row.getAllByText("или")).toHaveLength(2);
  });

  it("у этапа без исполнителей Main Agent стоит один и без крестика", async () => {
    const row = within(await rowOf(open(), 2));
    expect(row.getByText("Main Agent")).toBeTruthy();
    expect(row.queryByRole("button", { name: "Убрать Main Agent" })).toBeNull();
    expect(row.queryByText("или")).toBeNull();
  });

  it("крестик снимает Main Agent с этапа, а пункт меню возвращает", async () => {
    const slot = open();
    fireEvent.click(within(await rowOf(slot, 3)).getByRole("button", { name: "Убрать Main Agent" }));
    await waitFor(() => expect(savedStage(slot, 3)?.mainAgent).toBe(false));
    expect(within(await rowOf(slot, 3)).queryByText("Main Agent")).toBeNull();

    fireEvent.click(within(await rowOf(slot, 3)).getByRole("button", { name: "Исполнение этапа" }));
    const menu = within(await slot.findByRole("menu", { name: "Исполнение" }));
    fireEvent.click(menu.getByRole("menuitemcheckbox", { name: /Main Agent/ }));
    await waitFor(() => expect(savedStage(slot, 3) !== undefined && "mainAgent" in savedStage(slot, 3)!).toBe(false));
  });
});
