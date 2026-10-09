// @vitest-environment jsdom
// Тумблер «Очищать контекст после автоматического выбора flow» в общих настройках Flow.
import { cleanup, fireEvent } from "@testing-library/react";
import type { PluginSettingsSectionProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FlowSettings, flowSettingsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const settings: FlowSettings = { version: 2, flows: [{ id: "default", name: "Default", stages: [] }], minButtonWidth: 170 };

const open = (initial: FlowSettings = settings) =>
  renderSlot<PluginSettingsSectionProps, typeof flowSettingsRpcContract>(app.settingsSections.find((s) => s.id === "auto-choice")!, {}, {
    rpc: { getFlowSettings: () => initial, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }), getRootSkill: () => null } as never,
    settings: { language: "Русский" },
  });

const lastSaved = (slot: ReturnType<typeof open>): FlowSettings | undefined => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;

const NAME = "Очищать контекст после автоматического выбора flow";

describe("тумблер очистки контекста после автоматического выбора flow", () => {
  it("по умолчанию включён", async () => {
    const slot = open();
    expect((await slot.findByRole("switch", { name: NAME })).getAttribute("aria-checked")).toBe("true");
  });

  it("выключение сохраняется в общих настройках Flow", async () => {
    const slot = open();
    fireEvent.click(await slot.findByRole("switch", { name: NAME }));
    await vi.waitFor(() => expect(lastSaved(slot)?.clearContextAfterAutoChoice).toBe(false));
  });

  it("сохранённое «выключено» видно сразу", async () => {
    const slot = open({ ...settings, clearContextAfterAutoChoice: false });
    expect((await slot.findByRole("switch", { name: NAME })).getAttribute("aria-checked")).toBe("false");
  });
});
