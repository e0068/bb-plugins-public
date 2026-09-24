// @vitest-environment jsdom
// Таблица этапов на телефоне: списки полей открываются нижней шторой, а не
// выпадающим списком, прижатым к полю. Ширину экрана тесты задают через тот же
// медиазапрос, по которому компактность узнаёт и плагин.
import { cleanup, fireEvent } from "@testing-library/react";
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

  it("поле навыка открывает нижнюю штору со списком навыков", async () => {
    const slot = open();
    fireEvent.click(await slot.findByRole("combobox", { name: "Навык этапа 1" }));
    expect(inSheet(await slot.findByRole("listbox", { name: "Навыки" }))).toBe(true);
  });

  it("выбранный в шторе навык сохраняется, и штора закрывается", async () => {
    const slot = open();
    fireEvent.click(await slot.findByRole("combobox", { name: "Навык этапа 1" }));
    fireEvent.click(await slot.findByRole("option", { name: /spec/ }));
    await vi.waitFor(() => expect(lastSaved(slot)?.flows[0]?.stages[0]).toMatchObject({ skill: "spec" }));
    await vi.waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  });

  it("исполнители этапа открываются нижней шторой", async () => {
    const slot = open();
    fireEvent.click(await slot.findByRole("button", { name: "Добавить агента или workflow" }));
    expect(inSheet(await slot.findByRole("menu", { name: "Агенты и workflow" }))).toBe(true);
    expect(await slot.findByRole("menuitemcheckbox", { name: /Имплементер/ })).toBeTruthy();
  });

  it("добавление этапа выбирает навык в шторе", async () => {
    const slot = open();
    fireEvent.click(await slot.findByRole("button", { name: "Добавить этап Навык" }));
    expect(inSheet(await slot.findByRole("listbox", { name: "Навыки" }))).toBe(true);
  });
});

describe("те же списки на широком экране", () => {
  beforeEach(() => {
    compact = false;
  });

  it("остаются прижатыми к полю, без шторы", async () => {
    const slot = open();
    fireEvent.focus(await slot.findByRole("combobox", { name: "Навык этапа 1" }));
    expect(await slot.findByRole("listbox", { name: "Навыки" })).toBeTruthy();
    expect(slot.queryByRole("dialog")).toBeNull();
  });
});
