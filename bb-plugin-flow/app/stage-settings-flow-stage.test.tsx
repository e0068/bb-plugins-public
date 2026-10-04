// @vitest-environment jsdom
// Этап «Flow» на странице Flow: группа «Flow» в меню «Добавить этап», подпись строки, замена flow и удалённый flow.
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import type { Flow, FlowSettings, flowSettingsRpcContract, StageCatalog, WorkStage } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const stage = (id: string, patch: Partial<WorkStage> = {}): WorkStage => ({ id, kind: "skill", skill: id, name: id, executors: [], ...patch });
const ref = (id: string, flowId: string, name = "Ответ"): WorkStage => ({ id, kind: "skill", skill: "", name, executors: [], flowId });
const flow = (id: string, name: string, stages: WorkStage[]): Flow => ({ id, name, stages });
const catalog: StageCatalog = { skills: [], executors: [] };

const ANSWER = flow("answer", "Answer", [stage("project"), stage("demo")]);
const PLUGIN = (stages: WorkStage[]) => flow("plugin", "BB Plugin", stages);

/** Страница Flow на flow «BB Plugin»; остальные flow — соседи по коллекции. */
const open = (flows: Flow[]) => {
  const settings: FlowSettings = { flows, minButtonWidth: 170 };
  return renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "plugin" }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog, getRootSkill: () => null } as never,
    settings: { language: "Русский" },
  });
};

type Slot = ReturnType<typeof open>;

const savedPlugin = (slot: Slot): WorkStage[] | null => {
  const calls = slot.rpcCalls.filter((c) => c.method === "saveFlowSettings");
  const last = calls[calls.length - 1]?.input as FlowSettings | undefined;
  return last?.flows.find((f) => f.id === "plugin")?.stages ?? null;
};

const openMenu = async (slot: Slot) => {
  fireEvent.click(await slot.findByRole("button", { name: "Добавить этап" }));
  return slot.findByRole("menu", { name: "Добавить этап" });
};

describe("этап «Flow» на странице Flow", () => {
  it("«Добавить этап» при другом flow в коллекции открывает меню с группой «Flow»", async () => {
    const slot = open([PLUGIN([stage("task")]), ANSWER]);
    const menu = await openMenu(slot);
    const group = within(menu).getByRole("group", { name: "Flow" });
    expect(within(group).getByRole("menuitem", { name: "Answer" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Пустой этап" })).toBeTruthy();
  });

  it("выбор flow ставит строку в конец таблицы: этап навыка без навыка, с flowId и названием flow", async () => {
    const slot = open([PLUGIN([stage("task")]), ANSWER]);
    const menu = await openMenu(slot);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Answer" }));
    await waitFor(() => expect(savedPlugin(slot)?.at(-1)).toMatchObject({ kind: "skill", skill: "", executors: [], flowId: "answer", name: "Answer" }));
    expect(savedPlugin(slot)).toHaveLength(2);
  });

  it("строка подписана живым названием вложенного flow и числом его этапов", async () => {
    const slot = open([PLUGIN([ref("nested", "answer")]), ANSWER]);
    expect(await slot.findByText("Flow: Answer · 2 этапа")).toBeTruthy();
  });

  it("подпись следует за переименованием вложенного flow", async () => {
    const slot = open([PLUGIN([ref("nested", "answer")]), { ...ANSWER, name: "Ответ v2" }]);
    expect(await slot.findByText("Flow: Ответ v2 · 2 этапа")).toBeTruthy();
  });

  it("удалённый вложенный flow — подпись «flow удалён», таблица открывается", async () => {
    const slot = open([PLUGIN([stage("task"), ref("nested", "missing")]), ANSWER]);
    expect(await slot.findByText("flow удалён")).toBeTruthy();
    expect(slot.getAllByRole("row").length).toBeGreaterThan(2);
  });

  it("в списке нет самого flow и тех, что включают его", async () => {
    const includesPlugin = flow("outer", "Outer", [ref("r", "plugin")]);
    const slot = open([PLUGIN([stage("task")]), ANSWER, includesPlugin]);
    const menu = await openMenu(slot);
    const group = within(menu).getByRole("group", { name: "Flow" });
    expect(within(group).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Answer"]);
  });

  it("плюс у строки заменяет вложенный flow на выбранный", async () => {
    const code = flow("code", "Code", [stage("implement")]);
    const slot = open([PLUGIN([ref("nested", "answer")]), ANSWER, code]);
    fireEvent.click(await slot.findByRole("button", { name: "Заменить flow" }));
    const menu = await slot.findByRole("menu", { name: "Заменить flow" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Code" }));
    await waitFor(() => expect(savedPlugin(slot)).toEqual([expect.objectContaining({ id: "nested", flowId: "code" })]));
  });

  it("у строки «Flow» нет закладки шаблона, у обычного этапа — есть", async () => {
    const slot = open([PLUGIN([stage("task"), ref("nested", "answer")]), ANSWER]);
    const task = within(await slot.findByRole("row", { name: "Этап 1" }));
    const nested = within(await slot.findByRole("row", { name: "Этап 2" }));
    expect(task.getByRole("button", { name: "Сохранить этап шаблоном" })).toBeTruthy();
    expect(nested.queryByRole("button", { name: "Сохранить этап шаблоном" })).toBeNull();
  });

  it("flow без соседей: «Добавить этап» по-прежнему сразу добавляет пустой этап", async () => {
    const slot = open([PLUGIN([stage("task")])]);
    fireEvent.click(await slot.findByRole("button", { name: "Добавить этап" }));
    await waitFor(() => expect(savedPlugin(slot)).toHaveLength(2));
    expect(slot.queryByRole("menu")).toBeNull();
  });
});
