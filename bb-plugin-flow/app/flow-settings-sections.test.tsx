// @vitest-environment jsdom
// Общие настройки Flow — на странице настроек плагина: ширина кнопки этапа.
import { cleanup, fireEvent } from "@testing-library/react";
import type { PluginSettingsSectionProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FlowSettings, flowSettingsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const settings: FlowSettings = { version: 2, flows: [{ id: "default", name: "Default", stages: [] }], minButtonWidth: 170 };

const open = (id: string) =>
  renderSlot<PluginSettingsSectionProps, typeof flowSettingsRpcContract>(app.settingsSections.find((s) => s.id === id)!, {}, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }) } as never,
    settings: { language: "Русский" },
  });

type Slot = ReturnType<typeof open>;
const lastSaved = (slot: Slot): FlowSettings | undefined => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;

describe("секции настроек Flow", () => {
  it("ширина кнопки этапа сохраняется для всех flow", async () => {
    const slot = open("stage-buttons");
    const input = await slot.findByRole("spinbutton", { name: "Минимальная ширина кнопки, px" });
    fireEvent.change(input, { target: { value: "220" } });
    fireEvent.blur(input);
    await vi.waitFor(() => expect(lastSaved(slot)?.minButtonWidth).toBe(220));
  });
});
