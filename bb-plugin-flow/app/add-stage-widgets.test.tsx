// @vitest-environment jsdom
// Встроенные этапы-виджеты в меню «Добавить этап»: Вопросы, Definition of Done, Выбор этапов, Демонстрация.
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { FlowSettings, flowSettingsRpcContract, WorkStage } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const task: WorkStage = { id: "task", kind: "skill", skill: "task-flow", name: "Task", executors: [] };
const settings: FlowSettings = { flows: [{ id: "default", name: "Default", stages: [task] }], minButtonWidth: 170 };

const open = () =>
  renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "default" }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }), getRootSkill: () => null } as never,
    settings: { language: "Русский" },
  });

type Slot = ReturnType<typeof open>;

const savedStages = (slot: Slot): WorkStage[] | undefined =>
  ([...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined)?.flows[0]?.stages;

const openMenu = async (slot: Slot, button: string) => {
  fireEvent.click(await slot.findByRole("button", { name: button }));
  return within(await slot.findByRole("menu", { name: button }));
};

describe("виджеты в меню «Добавить этап»", () => {
  it("без шаблонов и других flow «Добавить этап» открывает меню с группой «Виджеты» из пяти встроенных этапов", async () => {
    const menu = await openMenu(open(), "Добавить этап");
    const group = within(menu.getByRole("group", { name: "Виджеты" }));
    expect(group.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Вопросы", "Definition of Done", "Выбор этапов", "Демонстрация", "Утверждение"]);
    expect(menu.getByRole("menuitem", { name: "Пустой этап" })).toBeTruthy();
  });

  it("выбранный виджет встаёт в конец таблицы встроенным этапом своего вида и со своим названием", async () => {
    const slot = open();
    const menu = await openMenu(slot, "Добавить этап");
    fireEvent.click(menu.getByRole("menuitem", { name: "Демонстрация" }));
    await vi.waitFor(() => expect(savedStages(slot)).toHaveLength(2));
    expect(savedStages(slot)?.at(-1)).toMatchObject({ kind: "demo", skill: "", executors: [], name: builtinStage("demo", []).name });
  });

  it("у «Добавить скрипт» виджетов нет", async () => {
    const slot = open();
    fireEvent.click(await slot.findByRole("button", { name: "Добавить скрипт" }));
    expect(slot.queryByRole("group", { name: "Виджеты" })).toBeNull();
  });
});
