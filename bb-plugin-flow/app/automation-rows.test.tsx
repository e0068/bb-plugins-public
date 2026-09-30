// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { automationStage, builtinStage } from "../lib/stage-constants";
import type { FlowSettings, flowSettingsRpcContract, StageCatalog, WorkStage } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const settings = (extra: WorkStage[] = []): FlowSettings => ({
  flows: [{ id: "default", name: "Default", stages: [builtinStage("questions", []), { id: "task", kind: "skill", skill: "task-flow", name: "Задача", executors: [] }, ...extra] }],
  minButtonWidth: 170,
});
const catalog: StageCatalog = { skills: [{ name: "spec" }], executors: [] };
const AUTOMATIONS = {
  automations: [
    { id: "click-pr", name: "Pull Request", enabled: true, steps: ["Открыть PR", "Задача → in_review"] },
    { id: "click-merge", name: "Merge", enabled: true, steps: ["Смёрджить PR"] },
    { id: "off", name: "Выключенная", enabled: false },
  ],
  triggers: [],
  conditions: [],
  actions: [],
};

function stubAutomations(answer: () => Response | Promise<Response>) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(String(url));
    return answer();
  });
  return urls;
}

const open = (initial: FlowSettings = settings()) =>
  renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
    rpc: { getFlowSettings: () => initial, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog } as never,
    settings: { language: "Русский" },
  });
type Slot = ReturnType<typeof open>;
const lastSaved = (slot: Slot) => ([...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined)?.flows[0]?.stages;

const builtin = (steps: NonNullable<Extract<WorkStage["automation"], { source: "flow" }>>["steps"]): WorkStage => ({ id: "flow-automation", kind: "skill", skill: "", name: "Опубликовать", executors: [], automation: { source: "flow", steps } });

describe("Автоматизация Automations в таблице этапов", () => {
  it("у автоматизации из Automations теги шагов без креста, название целиком по наведению", async () => {
    stubAutomations(() => new Response(JSON.stringify(AUTOMATIONS), { status: 200 }));
    const long = "Pull Request, Merge then Archive — очень длинное название автоматизации";
    const slot = open(settings([{ ...automationStage({ id: "click-pr", name: long }), automation: { id: "click-pr", name: long, steps: ["Открыть PR", "Смёрджить PR"] } }]));
    const row = within(await slot.findByRole("row", { name: "Этап 3" }));
    expect(row.getByTitle(long)).toBeTruthy();
    expect(row.getAllByRole("listitem").map((t) => t.textContent)).toEqual(["Открыть PR", "Смёрджить PR"]);
    expect(row.queryByRole("button", { name: /Убрать шаг/ })).toBeNull();
    expect(row.queryByRole("combobox")).toBeNull();
    expect(row.getByRole("button", { name: `Удалить этап ${long}` })).toBeTruthy();
  });
});

describe("встроенная автоматизация", () => {
  it("кнопка «Автоматизация» добавляет этап без шагов и открывает меню шагов", async () => {
    stubAutomations(() => new Response("{}", { status: 404 }));
    const slot = open();
    fireEvent.click(await slot.findByRole("button", { name: "Автоматизация" }));
    await vi.waitFor(() => expect(lastSaved(slot)?.at(-1)).toMatchObject({ kind: "skill", skill: "", name: "Автоматизация", automation: { source: "flow", steps: [] } }));
    expect(await slot.findByRole("menu", { name: "Шаги автоматизации" })).toBeTruthy();
  });

  it("шаг добавляется из меню, уже стоящий в меню недоступен", async () => {
    stubAutomations(() => new Response("{}", { status: 404 }));
    const slot = open(settings([builtin(["git.create-pr"])]));
    const row = within(await slot.findByRole("row", { name: "Этап 3" }));
    fireEvent.click(row.getByRole("button", { name: "Добавить шаг" }));
    const menu = within(await slot.findByRole("menu", { name: "Шаги автоматизации" }));
    expect(menu.getByRole("menuitem", { name: "Открыть PR" }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(menu.getByRole("menuitem", { name: "Смёрджить PR" }));
    await vi.waitFor(() => expect(lastSaved(slot)?.at(-1)?.automation).toEqual({ source: "flow", steps: ["git.create-pr", "git.merge"] }));
  });

  it("шаг убирается крестом", async () => {
    stubAutomations(() => new Response("{}", { status: 404 }));
    const slot = open(settings([builtin(["git.create-pr", "bb.tasks-in-review"])]));
    const row = within(await slot.findByRole("row", { name: "Этап 3" }));
    fireEvent.click(row.getByRole("button", { name: "Убрать шаг Задача → in_review" }));
    await vi.waitFor(() => expect(lastSaved(slot)?.at(-1)?.automation).toEqual({ source: "flow", steps: ["git.create-pr"] }));
  });

  it("шаг переставляется перетаскиванием тега", async () => {
    stubAutomations(() => new Response("{}", { status: 404 }));
    const slot = open(settings([builtin(["git.create-pr", "git.merge", "bb.archive"])]));
    const row = within(await slot.findByRole("row", { name: "Этап 3" }));
    const [first, , last] = row.getAllByRole("listitem");
    fireEvent.dragStart(last!);
    fireEvent.dragOver(first!);
    fireEvent.drop(first!);
    await vi.waitFor(() => expect(lastSaved(slot)?.at(-1)?.automation).toEqual({ source: "flow", steps: ["bb.archive", "git.create-pr", "git.merge"] }));
  });
});
