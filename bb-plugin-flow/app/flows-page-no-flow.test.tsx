// @vitest-environment jsdom
// «Без flow» на странице Flow: первая строка списка, всегда на месте; её страница — одно описание «когда flow не нужен»,
// без имени, этапов, удаления и ограничений.
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NO_FLOW } from "../core/flows";
import type { FlowSettings, flowSettingsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const settings: FlowSettings = {
  version: 2,
  flows: [
    { id: "default", name: "Default", stages: [] },
    { id: "quick", name: "Quick", stages: [] },
  ],
  minButtonWidth: 170,
  noFlowDescription: "Вопросы без правок",
};

const open = (subPath = "", initial: FlowSettings = settings) =>
  renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath }, {
    rpc: { getFlowSettings: () => initial, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }) } as never,
    settings: { language: "Русский" },
  });

type Slot = ReturnType<typeof open>;
const lastSaved = (slot: Slot): FlowSettings | undefined => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;
const list = (slot: Slot) => slot.findByRole("navigation", { name: "Flow" });

describe("«Без flow» в списке flow", () => {
  it("первая строка списка, перед flow владельца", async () => {
    const rows = within(await list(open())).getAllByRole("button").map((button) => button.textContent);
    expect(rows.slice(0, 3)).toEqual(["Без flow", "Default", "Quick"]);
  });

  it("стоит и при единственном flow", async () => {
    const single = { ...settings, flows: [settings.flows[0]!] };
    expect(within(await list(open("", single))).getByRole("button", { name: "Без flow" })).toBeTruthy();
  });

  it("открытая по адресу — подсвечена, а flow по умолчанию нет", async () => {
    const nav = within(await list(open(NO_FLOW)));
    expect(nav.getByRole("button", { name: "Без flow" }).getAttribute("aria-current")).toBe("page");
    expect(nav.getByRole("button", { name: "Default" }).getAttribute("aria-current")).toBeNull();
  });
});

describe("страница «Без flow»", () => {
  it("только описание: нет имени, этапов и удаления", async () => {
    const slot = open(NO_FLOW);
    const description = (await slot.findByRole("textbox", { name: "Когда flow не нужен" })) as HTMLTextAreaElement;
    expect(description.value).toBe("Вопросы без правок");
    expect(slot.queryByRole("textbox", { name: "Название flow" })).toBeNull();
    expect(slot.queryByRole("button", { name: /Удалить/ })).toBeNull();
    expect(slot.queryByRole("button", { name: /Добавить этап/ })).toBeNull();
  });

  it("описание сохраняется по уходу фокуса, flow не трогаются", async () => {
    const slot = open(NO_FLOW);
    const description = await slot.findByRole("textbox", { name: "Когда flow не нужен" });
    fireEvent.change(description, { target: { value: "  Ответы на вопросы  " } });
    fireEvent.blur(description);
    await vi.waitFor(() => expect(lastSaved(slot)?.noFlowDescription).toBe("Ответы на вопросы"));
    expect(lastSaved(slot)?.flows).toEqual(settings.flows);
  });

  it("стёртое описание снимается", async () => {
    const slot = open(NO_FLOW);
    const description = await slot.findByRole("textbox", { name: "Когда flow не нужен" });
    fireEvent.change(description, { target: { value: "   " } });
    fireEvent.blur(description);
    await vi.waitFor(() => expect(lastSaved(slot)).toBeDefined());
    expect(lastSaved(slot)).not.toHaveProperty("noFlowDescription");
  });
});
