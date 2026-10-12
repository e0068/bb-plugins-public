// @vitest-environment jsdom
// Блок «Агент» на странице Flow: своя модель — выбором модели bb, засеянным моделью по умолчанию, стартовое сообщение — полем;
// «Автоматически» — строка списка со своим блоком.
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTO_FLOW } from "../core/flows";
import type { Execution, FlowSettings, flowSettingsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const opus: Execution = { providerId: "claude-code", model: "opus", reasoningLevel: "high" };
const settings: FlowSettings = { version: 2, flows: [{ id: "default", name: "Default", stages: [] }], minButtonWidth: 170 };

const open = (subPath: string, initial: FlowSettings = settings, seed: Execution | null = opus) =>
  renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath }, {
    rpc: { getFlowSettings: () => initial, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }), defaultExecution: () => seed } as never,
    settings: { language: "Русский" },
  });

type Slot = ReturnType<typeof open>;
const lastSaved = (slot: Slot): FlowSettings | undefined => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;

describe("блок «Агент» у flow", () => {
  it("«Своя модель» засевает модель по умолчанию и пишет её во flow; выключение снимает", async () => {
    const slot = open("default");
    const block = within(await slot.findByRole("region", { name: "Агент" }));
    fireEvent.click(block.getByRole("switch", { name: "Своя модель" }));
    await vi.waitFor(() => expect(lastSaved(slot)?.flows[0]?.agent).toEqual({ execution: opus }));
    fireEvent.click(block.getByRole("switch", { name: "Своя модель" }));
    await vi.waitFor(() => expect(lastSaved(slot)?.flows[0]).not.toHaveProperty("agent"));
  });

  it("каталог не прочёлся — модель не ставится, под переключателем ошибка", async () => {
    const slot = open("default", settings, null);
    const block = within(await slot.findByRole("region", { name: "Агент" }));
    fireEvent.click(block.getByRole("switch", { name: "Своя модель" }));
    expect(await block.findByText(/Не удалось прочесть модели bb/)).toBeTruthy();
    expect(lastSaved(slot)).toBeUndefined();
  });

  it("стартовое сообщение сохраняется по уходу фокуса", async () => {
    const slot = open("default");
    const field = await slot.findByRole("textbox", { name: "Стартовое сообщение" });
    fireEvent.change(field, { target: { value: "Пиши коротко" } });
    fireEvent.blur(field);
    await vi.waitFor(() => expect(lastSaved(slot)?.flows[0]?.agent).toEqual({ start: "Пиши коротко" }));
  });
});

describe("«Автоматически» на странице Flow", () => {
  it("строка списка сразу под «Без flow»; её страница — имя и блок «Агент», без этапов", async () => {
    const slot = open(AUTO_FLOW);
    const nav = within(await slot.findByRole("navigation", { name: "Flow" }));
    expect(nav.getByRole("button", { name: "Автоматически" }).getAttribute("aria-current")).toBe("page");
    expect(await slot.findByRole("heading", { name: "Автоматически" })).toBeTruthy();
    expect(slot.queryByRole("button", { name: "Добавить этап" })).toBeNull();
    const field = slot.getByRole("textbox", { name: "Стартовое сообщение" });
    fireEvent.change(field, { target: { value: "Сперва выбери flow" } });
    fireEvent.blur(field);
    await vi.waitFor(() => expect(lastSaved(slot)?.autoAgent).toEqual({ start: "Сперва выбери flow" }));
  });
});
