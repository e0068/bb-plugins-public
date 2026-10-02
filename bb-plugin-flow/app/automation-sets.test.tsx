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

const publish: WorkStage = { id: "flow-automation", kind: "skill", skill: "", name: "Опубликовать", executors: [], automation: { source: "flow", steps: ["git.create-pr", "git.merge"] } };

const settings = (extra: Partial<FlowSettings> = {}, stages: WorkStage[] = []): FlowSettings => ({
  flows: [{ id: "default", name: "Default", stages: [builtinStage("questions", []), ...stages] }],
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

describe("сохранённые наборы автоматизаций", () => {
  it("кнопка у строки автоматизации сохраняет её шаги набором", async () => {
    const slot = open(settings({}, [publish]));
    const row = within(await slot.findByRole("row", { name: "Этап 2" }));
    fireEvent.click(row.getByRole("button", { name: "Сохранить набор" }));
    await vi.waitFor(() => expect(lastSaved(slot)?.automationSets).toEqual([{ steps: ["git.create-pr", "git.merge"] }]));
  });

  it("сохранённый набор — кнопка у строки недоступна", async () => {
    const slot = open(settings({ automationSets: [{ steps: ["git.create-pr", "git.merge"] }] }, [publish]));
    const row = within(await slot.findByRole("row", { name: "Этап 2" }));
    expect(row.getByRole("button", { name: "Сохранить набор" }).hasAttribute("disabled")).toBe(true);
  });
});
