// @vitest-environment jsdom
// Автоповтор автоматизаций — секция настроек плагина: «Retry in» в секундах и число попыток, общие на все flow.
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

type Slot = ReturnType<typeof open>;
const lastSaved = (slot: Slot): FlowSettings | undefined => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;

const type = (input: HTMLElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

describe("секция автоповтора автоматизаций", () => {
  it("секунды и попытки сохраняются в общие настройки Flow", async () => {
    const slot = open();
    type(await slot.findByRole("spinbutton", { name: "Retry in, секунд" }), "45");
    await vi.waitFor(() => expect(lastSaved(slot)?.retryInSeconds).toBe(45));
    type(slot.getByRole("spinbutton", { name: "Попыток" }), "0");
    await vi.waitFor(() => expect(lastSaved(slot)).toMatchObject({ retryInSeconds: 45, retryAttempts: 0 }));
  });

  it("0 секунд сохраняется: повтор выключается", async () => {
    const slot = open({ ...settings, retryInSeconds: 30 });
    type(await slot.findByRole("spinbutton", { name: "Retry in, секунд" }), "0");
    await vi.waitFor(() => expect(lastSaved(slot)?.retryInSeconds).toBe(0));
  });

  it("отрицательное и нечисло не сохраняются как есть", async () => {
    const slot = open({ ...settings, retryInSeconds: 30 });
    const input = await slot.findByRole("spinbutton", { name: "Retry in, секунд" });
    type(input, "");
    type(input, "-5");
    await vi.waitFor(() => expect(lastSaved(slot)?.retryInSeconds).toBe(0));
    expect(slot.rpcCalls.filter((c) => c.method === "saveFlowSettings")).toHaveLength(1);
  });
});
