// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { FlowSettings, flowSettingsRpcContract, WorkStage } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const review: WorkStage = { id: "code-review", kind: "skill", skill: "code-review", name: "Ревью", executors: [] };
const criteria: WorkStage = { ...builtinStage("criteria", []), parent: "questions" };

const settings = (extra: Partial<FlowSettings> = {}, stages: WorkStage[] = [review]): FlowSettings => ({
  flows: [{ id: "default", name: "Default", stages: [builtinStage("questions", []), criteria, ...stages] }],
  minButtonWidth: 170,
  ...extra,
});

const open = (initial: FlowSettings) => {
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 404 }));
  return renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
    rpc: { getFlowSettings: () => initial, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }) } as never,
    settings: { language: "Русский" },
  });
};
type Slot = ReturnType<typeof open>;
const lastSaved = (slot: Slot) => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;
const savedStages = (slot: Slot) => lastSaved(slot)?.flows[0]?.stages;

describe("строки таблицы этапов", () => {
  it("над таблицей нет заголовка и подсказки о порядке этапов", async () => {
    const slot = open(settings());
    await slot.findByRole("row", { name: "Этап 3" });
    expect(slot.queryByText("Этапы работ")).toBeNull();
    expect(slot.queryByText(/Порядок в таблице/)).toBeNull();
  });

  it("у под-этапа нет ни иконки, ни поля названия; у этапа верхнего уровня есть оба", async () => {
    const slot = open(settings());
    const sub = within(await slot.findByRole("row", { name: "Этап 2" }));
    expect(sub.queryByRole("button", { name: /^Иконка этапа/ })).toBeNull();
    expect(sub.queryByRole("textbox", { name: /Название этапа/ })).toBeNull();
    const top = within(slot.getByRole("row", { name: "Этап 3" }));
    expect(top.getByRole("button", { name: /^Иконка этапа/ })).toBeTruthy();
    expect(top.getByRole("textbox", { name: /Название этапа/ })).toBeTruthy();
  });

  it("клик по иконке открывает подборку с поиском; выбранная иконка сохраняется в этапе, «По виду» её снимает", async () => {
    const slot = open(settings());
    const row = within(await slot.findByRole("row", { name: "Этап 3" }));
    fireEvent.click(row.getByRole("button", { name: /^Иконка этапа/ }));
    fireEvent.change(row.getByRole("searchbox", { name: "Найти иконку" }), { target: { value: "rock" } });
    expect(row.queryByRole("option", { name: "Code" })).toBeNull();
    fireEvent.click(row.getByRole("option", { name: "Rocket" }));
    await vi.waitFor(() => expect(savedStages(slot)?.find((s) => s.id === "code-review")?.icon).toBe("Rocket"));
    fireEvent.click(row.getByRole("button", { name: /^Иконка этапа/ }));
    fireEvent.click(row.getByRole("option", { name: "По виду" }));
    await vi.waitFor(() => expect(savedStages(slot)?.find((s) => s.id === "code-review")?.icon).toBeUndefined());
  });

  it("чипс виджета в исполнении — с иконкой своего вида", async () => {
    const slot = open(settings());
    const row = within(await slot.findByRole("row", { name: "Этап 1" }));
    const chip = row.getByText("Вопросы").closest("span")!.parentElement!;
    expect(chip.querySelector('[data-icon="MessageQuestion"]')).not.toBeNull();
  });
});

describe("шаблоны этапов", () => {
  it("закладка есть у каждой строки и сохраняет этап целиком шаблоном", async () => {
    const slot = open(settings());
    await slot.findByRole("row", { name: "Этап 3" });
    for (const name of ["Этап 1", "Этап 2", "Этап 3"]) expect(within(slot.getByRole("row", { name })).getByRole("button", { name: "Сохранить этап шаблоном" })).toBeTruthy();
    fireEvent.click(within(slot.getByRole("row", { name: "Этап 3" })).getByRole("button", { name: "Сохранить этап шаблоном" }));
    await vi.waitFor(() => expect(lastSaved(slot)?.stageTemplates).toEqual([{ kind: "skill", skill: "code-review", name: "Ревью", executors: [] }]));
  });

  it("сохранённый этап — закладка недоступна", async () => {
    const slot = open(settings({ stageTemplates: [{ kind: "skill", skill: "code-review", name: "Ревью", executors: [] }] }));
    const row = within(await slot.findByRole("row", { name: "Этап 3" }));
    expect(row.getByRole("button", { name: "Сохранить этап шаблоном" }).hasAttribute("disabled")).toBe(true);
  });

  it("«Добавить этап» с шаблонами — меню: шаблон встаёт в конец таблицы таким, каким его сохранили", async () => {
    const slot = open(settings({ stageTemplates: [{ kind: "skill", skill: "spec", name: "Спека", icon: "Rocket", executors: [] }] }));
    fireEvent.click(await slot.findByRole("button", { name: "Добавить этап" }));
    fireEvent.click(slot.getByRole("menuitem", { name: "Спека" }));
    await vi.waitFor(() => expect(savedStages(slot)?.at(-1)).toMatchObject({ kind: "skill", skill: "spec", name: "Спека", icon: "Rocket", executors: [] }));
  });

  it("«Пустой этап» в меню добавляет новый этап, как прежде", async () => {
    const slot = open(settings({ stageTemplates: [{ kind: "skill", skill: "spec", name: "Спека", executors: [] }] }));
    fireEvent.click(await slot.findByRole("button", { name: "Добавить этап" }));
    fireEvent.click(slot.getByRole("menuitem", { name: "Пустой этап" }));
    await vi.waitFor(() => expect(savedStages(slot)?.at(-1)).toMatchObject({ kind: "skill", skill: "", name: "Новый этап" }));
  });

  it("крест у шаблона убирает его из меню", async () => {
    const slot = open(settings({ stageTemplates: [{ kind: "skill", skill: "spec", name: "Спека", executors: [] }] }));
    fireEvent.click(await slot.findByRole("button", { name: "Добавить этап" }));
    fireEvent.click(slot.getByRole("button", { name: "Убрать шаблон Спека" }));
    await vi.waitFor(() => expect(lastSaved(slot)?.stageTemplates).toEqual([]));
  });
});
