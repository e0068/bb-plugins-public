// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import type { PluginSettingsSectionProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FlowSettings, flowSettingsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const settings: FlowSettings = { version: 2, flows: [{ id: "default", name: "Default", stages: [] }], minButtonWidth: 170 };

const open = () =>
  renderSlot<PluginSettingsSectionProps, typeof flowSettingsRpcContract>(app.settingsSections.find((s) => s.id === "automation-retry")!, {}, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => ({ skills: [], executors: [] }), getRootSkill: () => null } as never,
    settings: { language: "Русский" },
  });

const lastSaved = (slot: ReturnType<typeof open>): FlowSettings | undefined => [...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined;

const SWITCH = "Реплика агенту после последней попытки";

describe("секция автоповтора без сохранённых полей", () => {
  it("показывает повтор через 30 секунд, 10 попыток и включённую реплику агенту", async () => {
    const slot = open();
    expect(((await slot.findByRole("spinbutton", { name: "Retry in, секунд" })) as HTMLInputElement).value).toBe("30");
    expect((slot.getByRole("spinbutton", { name: "Попыток" }) as HTMLInputElement).value).toBe("10");
    expect(slot.getByRole("switch", { name: SWITCH }).getAttribute("aria-checked")).toBe("true");
  });

  it("нажатие выключает реплику и сохраняет выбор в общие настройки Flow", async () => {
    const slot = open();
    fireEvent.click(await slot.findByRole("switch", { name: SWITCH }));
    await vi.waitFor(() => expect(lastSaved(slot)?.wakeAgentAfterLastRetry).toBe(false));
  });
});
