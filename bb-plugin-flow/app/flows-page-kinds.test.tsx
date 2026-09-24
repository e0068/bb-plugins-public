// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { planner } from "../core/stages-fixtures";
import { builtinStage, stageKindOf } from "../lib/stage-constants";
import type { FlowSettings, flowSettingsRpcContract, StageCatalog } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const settings: FlowSettings = {
  version: 2,
  flows: [
    {
      id: "default",
      name: "Default",
      stages: [
        builtinStage("questions", []),
        builtinStage("select", []),
        { id: "task", kind: "skill", skill: "task-flow", name: "Задача", executors: [] },
        { id: "plan", kind: "skill", skill: "plan", name: "План", executors: [planner] },
        builtinStage("demo", []),
      ],
    },
    { id: "quick", name: "Quick", stages: [builtinStage("criteria", []), { id: "implement", kind: "skill", skill: "code", name: "Код", executors: [] }] },
  ],
  minButtonWidth: 170,
};

const catalog: StageCatalog = {
  skills: [{ name: "spec", description: "Спецификация задачи" }, { name: "plan" }],
  executors: [planner, { id: "workflow:DEV2", kind: "workflow", name: "DEV2", description: "конвейер" }],
};

const open = (options: { subPath?: string; language?: string; initial?: FlowSettings } = {}) =>
  renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: options.subPath ?? "" }, {
    rpc: { getFlowSettings: () => options.initial ?? settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog } as never,
    settings: { language: options.language ?? "Русский" },
  });

type Slot = ReturnType<typeof open>;
const lastSaved = (slot: Slot): FlowSettings | undefined => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;
const flowOf = (saved: FlowSettings | undefined, id: string) => saved?.flows.find((f) => f.id === id);
const row = async (slot: Slot, n: number) => within(await slot.findByRole("row", { name: `Этап ${n}` }));

describe("таблица этапов выбранного flow", () => {
  it("в таблице нет Review by User — ни в шапке, ни в строках", async () => {
    const slot = open();
    await row(slot, 3);
    expect(slot.queryByRole("button", { name: "Review by User" })).toBeNull();
    expect(slot.queryByLabelText("Review by User")).toBeNull();
  });

  it("строка своего этапа: навык, название, плюс исполнителя и теги", async () => {
    const slot = open();
    const plan = await row(slot, 4);
    expect((plan.getByRole("combobox", { name: "Навык этапа 4" }) as HTMLInputElement).value).toBe("plan");
    expect(plan.getByText("planner")).toBeTruthy();
  });

  it("название встроенного вида правится и сохраняется", async () => {
    const slot = open();
    fireEvent.change((await row(slot, 2)).getByRole("textbox", { name: "Название этапа 2" }), { target: { value: "Что делаем" } });
    await vi.waitFor(() => expect(flowOf(lastSaved(slot), "default")?.stages[1]?.name).toBe("Что делаем"), { timeout: 2000 });
  });

  it("исполнитель из меню и удаление этапа сохраняют этапы выбранного flow", async () => {
    const slot = open();
    fireEvent.click((await row(slot, 4)).getByRole("button", { name: "Добавить агента или workflow" }));
    fireEvent.click(slot.getByRole("menuitemcheckbox", { name: /DEV2/ }));
    await vi.waitFor(() => expect(flowOf(lastSaved(slot), "default")?.stages[3]?.executors.map((e) => e.id)).toEqual([planner.id, "workflow:DEV2"]));
    fireEvent.click((await row(slot, 3)).getByRole("button", { name: "Удалить этап Задача" }));
    await vi.waitFor(() => expect(flowOf(lastSaved(slot), "default")?.stages.map((s) => s.id)).toEqual(["questions", "select", "plan", "demo"]));
    expect(flowOf(lastSaved(slot), "quick")).toEqual(settings.flows[1]);
  });

  it("кнопки Вопросы, Критерии, Выбор этапов и Демонстрация дописывают этап вида в конец, повторный вид — с новым id", async () => {
    const slot = open();
    await row(slot, 1);
    fireEvent.click(slot.getByRole("button", { name: "Добавить этап Демонстрация" }));
    await vi.waitFor(() => expect(flowOf(lastSaved(slot), "default")?.stages.at(-1)).toMatchObject({ id: "demo-2", kind: "demo" }));
    fireEvent.click(slot.getByRole("button", { name: "Добавить этап Выбор этапов" }));
    await vi.waitFor(() => expect(flowOf(lastSaved(slot), "default")?.stages.at(-1)).toMatchObject({ id: "select-2", kind: "select" }));
    fireEvent.click(slot.getByRole("button", { name: "Добавить этап Вопросы" }));
    fireEvent.click(slot.getByRole("button", { name: "Добавить этап Критерии" }));
    await vi.waitFor(() => expect(flowOf(lastSaved(slot), "default")?.stages.slice(-2).map(stageKindOf)).toEqual(["questions", "criteria"]));
  });

  it("кнопка Навык открывает список навыков и дописывает этап навыка в конец", async () => {
    const slot = open();
    await row(slot, 1);
    fireEvent.click(slot.getByRole("button", { name: "Добавить этап Навык" }));
    fireEvent.click(slot.getByRole("option", { name: /spec/ }));
    await vi.waitFor(() => expect(flowOf(lastSaved(slot), "default")?.stages.at(-1)).toMatchObject({ kind: "skill", skill: "spec", name: "spec" }));
    expect(flowOf(lastSaved(slot), "default")?.stages.at(-1)?.review).toBeUndefined();
  });

  it("строка, перетащенная за ручку вниз, встаёт в конец и порядок сохраняется на отпускании", async () => {
    const slot = open();
    const handle = (await row(slot, 1)).getByRole("button", { name: "Перетащить этап Вопросы" });
    fireEvent.pointerDown(handle);
    fireEvent.pointerMove(window, { clientY: 500 });
    fireEvent.pointerUp(window);
    await vi.waitFor(() => expect(flowOf(lastSaved(slot), "default")?.stages.map((s) => s.id).at(-1)).toBe("questions"));
  });

  it("с настройкой English страница без кириллицы, виды подписаны по-английски", async () => {
    const english: FlowSettings = { version: 2, flows: [{ id: "default", name: "Default", stages: [builtinStage("questions", []), builtinStage("demo", []), { id: "plan", kind: "skill", skill: "plan", name: "Plan", executors: [planner] }] }], minButtonWidth: 170 };
    const slot = open({ language: "English", initial: english });
    expect(within(await slot.findByRole("row", { name: "Stage 1" })).getByText("Questions")).toBeTruthy();
    expect(slot.getByRole("button", { name: "Add stage Demonstration" })).toBeTruthy();
    const texts = [slot.container.textContent ?? "", ...[...slot.container.querySelectorAll("[aria-label],[placeholder],[title],[value]")].flatMap((el) => ["aria-label", "placeholder", "title"].map((a) => el.getAttribute(a) ?? ""))];
    expect(texts.filter((text) => /[А-Яа-яЁё]/.test(text))).toEqual([]);
  });
});
