// @vitest-environment jsdom
// Переключатель «Реплика агенту после последней попытки» в секции автоповтора автоматизаций.
import { cleanup, fireEvent } from "@testing-library/react";
import type { PluginSettingsSectionProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FlowSettings, flowSettingsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const settings: FlowSettings = { version: 2, flows: [{ id: "default", name: "Default", stages: [] }], minButtonWidth: 170 };

const open = (initial: FlowSettings = settings) =>
  renderSlot<PluginSettingsSectionProps, typeof flowSettingsRpcContract>(app.settingsSections.find((s) => s.id === "automation-retry")!, {}, {
    rpc: { getFlowSettings: () => initial, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }), getRootSkill: () => null } as never,
    settings: { language: "Русский" },
  });

const lastSaved = (slot: ReturnType<typeof open>): FlowSettings | undefined => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;

const NAME = "Реплика агенту после последней попытки";

describe("переключатель реплики агенту после последней попытки", () => {
  it("без сохранённого поля выключен", async () => {
    const slot = open();
    expect((await slot.findByRole("switch", { name: NAME })).getAttribute("aria-checked")).toBe("false");
  });

  it("нажатие включает и сохраняет в общие настройки Flow, повторное — выключает", async () => {
    const slot = open();
    fireEvent.click(await slot.findByRole("switch", { name: NAME }));
    await vi.waitFor(() => expect(lastSaved(slot)?.wakeAgentAfterLastRetry).toBe(true));
    await vi.waitFor(() => expect(slot.getByRole("switch", { name: NAME }).getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(slot.getByRole("switch", { name: NAME }));
    await vi.waitFor(() => expect(lastSaved(slot)?.wakeAgentAfterLastRetry).toBe(false));
  });

  it("сохранённое «включено» видно сразу", async () => {
    const slot = open({ ...settings, wakeAgentAfterLastRetry: true });
    expect((await slot.findByRole("switch", { name: NAME })).getAttribute("aria-checked")).toBe("true");
  });
});
