// @vitest-environment jsdom
// Строки этапов одного вида: поле навыка есть у любого этапа — со шагами скрипта, Action и автоматизации Automations
// тоже, — а крестик в поле очищает навык.
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { builtinAutomationStage } from "../core/automation-run";
import { actionStage, automationStage, builtinStage, NO_SKILL } from "../lib/stage-constants";
import type { FlowSettings, flowSettingsRpcContract, StageCatalog, WorkStage } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const STAGES: WorkStage[] = [
  builtinStage("questions", []),
  { id: "spec", kind: "skill", skill: "spec", name: "Spec", executors: [] },
  { ...builtinAutomationStage([]), id: "ship", name: "Ship", skill: "git-hygiene", automation: { source: "flow", steps: ["git.commit"] } },
  { ...actionStage([]), automation: { source: "flow", steps: ["bb.archive"] } },
  automationStage({ id: "release", name: "Release" }),
];

const catalog: StageCatalog = { skills: [{ name: "flow-questions" }, { name: "spec" }, { name: "git-hygiene" }], executors: [] };

const open = () => {
  const settings: FlowSettings = { version: 2, flows: [{ id: "default", name: "Default", stages: STAGES }], minButtonWidth: 170 };
  return renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "" }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog, getRootSkill: () => null } as never,
    settings: { language: "Русский" },
  });
};

type Slot = ReturnType<typeof open>;
const savedStage = (slot: Slot, n: number) => ([...slot.rpcCalls].reverse().find((c) => c.method === "saveFlowSettings")?.input as FlowSettings | undefined)?.flows[0]?.stages[n - 1];
const row = async (slot: Slot, n: number) => within(await slot.findByRole("row", { name: `Этап ${n}` }));
const skillField = async (slot: Slot, n: number) => (await row(slot, n)).getByRole("combobox", { name: `Навык этапа ${n}` }) as HTMLInputElement;

describe("поле навыка у этапов со шагами", () => {
  it("у скрипта и Action поля навыка нет, у автоматизации Automations — есть", async () => {
    const slot = open();
    expect((await row(slot, 3)).queryByRole("combobox", { name: "Навык этапа 3" })).toBeNull();
    expect((await row(slot, 4)).queryByRole("combobox", { name: "Навык этапа 4" })).toBeNull();
    expect((await skillField(slot, 5)).value).toBe("");
  });
});

describe("навык автоматизации Automations", () => {
  it("выбор навыка не трогает название — оно снимок того плагина", async () => {
    const slot = open();
    fireEvent.focus(await skillField(slot, 5));
    fireEvent.click(slot.getByRole("option", { name: /^spec/ }));
    await vi.waitFor(() => expect(savedStage(slot, 5)).toMatchObject({ skill: "spec", name: "Release", automation: { id: "release" } }));
  });
});

describe("крестик в поле навыка", () => {
  it("очищает навык, название этапа остаётся", async () => {
    const slot = open();
    fireEvent.click((await row(slot, 2)).getByRole("button", { name: "Очистить навык" }));
    await vi.waitFor(() => expect(savedStage(slot, 2)).toMatchObject({ skill: "", name: "Spec" }));
  });

  it("у встроенного этапа оставляет его без навыка, а не с навыком вида", async () => {
    const slot = open();
    fireEvent.click((await row(slot, 1)).getByRole("button", { name: "Очистить навык" }));
    await vi.waitFor(() => expect(savedStage(slot, 1)).toMatchObject({ kind: "questions", skill: NO_SKILL }));
    expect((await skillField(slot, 1)).value).toBe("");
  });

  it("у пустого поля крестика нет", async () => {
    const slot = open();
    expect((await row(slot, 4)).queryByRole("button", { name: "Очистить навык" })).toBeNull();
  });
});
