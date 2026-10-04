// @vitest-environment jsdom
// Таблица этапов на телефоне: списки полей открываются нижней шторой, а не
// выпадающим списком, прижатым к полю. Ширину экрана тесты задают через тот же
// медиазапрос, по которому компактность узнаёт и плагин.
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMPACT_VIEWPORT_QUERY } from "@/components/ui/hooks/use-compact-viewport";
import type { FlowSettings, flowSettingsRpcContract, StageCatalog } from "../shared/contract";

let compact = true;
window.matchMedia = (query: string) =>
  ({
    matches: query === COMPACT_VIEWPORT_QUERY ? compact : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const settings: FlowSettings = {
  version: 2,
  flows: [{ id: "default", name: "Default", stages: [{ id: "task", kind: "skill", skill: "task-flow", name: "Задача", executors: [] }] }],
  minButtonWidth: 170,
};

const catalog: StageCatalog = {
  skills: [{ name: "task-flow" }, { name: "spec", description: "Спецификация" }],
  executors: [{ id: "agent:implementer", kind: "agent", name: "Имплементер", model: "sonnet" }],
};

const open = () =>
  renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog, getRootSkill: () => null } as never,
    settings: { language: "Русский" },
  });

type Slot = ReturnType<typeof open>;
/** Штора — та же, что открывает выбор flow в композере: её тело помечено `data-persistent-drawer-content`. */
const inSheet = (element: HTMLElement): boolean => element.closest("[data-persistent-drawer-content]") !== null;
const lastSaved = (slot: Slot): FlowSettings | undefined => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;

describe("списки таблицы этапов на узком экране", () => {
  beforeEach(() => {
    compact = true;
  });

  it("меню исполнения поднимается нижней шторой с вкладками Навык, Субагент, Workflow, Виджет и ставит агента", async () => {
    const slot = open();
    fireEvent.click(await slot.findByRole("button", { name: "Исполнение этапа" }));
    const menu = await slot.findByRole("menu", { name: "Исполнение" });
    expect(inSheet(menu)).toBe(true);
    expect(within(menu).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Навык", "Субагент", "Workflow", "Виджет"]);
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: /Имплементер/ }));
    await vi.waitFor(() => expect(lastSaved(slot)?.flows[0]?.stages[0]?.executors.map((e) => e.id)).toEqual(["agent:implementer"]));
  });

  it("навык, выбранный в шторе на вкладке «Навык», сохраняется, и штора закрывается", async () => {
    const slot = open();
    fireEvent.click(await slot.findByRole("button", { name: "Исполнение этапа" }));
    const menu = within(await slot.findByRole("menu", { name: "Исполнение" }));
    fireEvent.mouseDown(menu.getByRole("tab", { name: "Навык" }), { button: 0 });
    fireEvent.click(await menu.findByRole("menuitemradio", { name: /spec/ }));
    await vi.waitFor(() => expect(lastSaved(slot)?.flows[0]?.stages[0]).toMatchObject({ skill: "spec" }));
    await vi.waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  });
});
