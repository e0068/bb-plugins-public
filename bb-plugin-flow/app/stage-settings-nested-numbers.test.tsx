// @vitest-environment jsdom
// Страница Flow: этапы под строкой вложенного flow пронумерованы с точкой — 2.1, 2.2, под-этапы без номера.
import { cleanup } from "@testing-library/react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import type { Flow, FlowSettings, flowSettingsRpcContract, StageCatalog, WorkStage } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const stage = (id: string, patch: Partial<WorkStage> = {}): WorkStage => ({ id, kind: "skill", skill: id, name: id, executors: [], ...patch });
const ref = (id: string, flowId: string): WorkStage => ({ id, kind: "skill", skill: "", name: "Answer", executors: [], flowId });
const flow = (id: string, name: string, stages: WorkStage[]): Flow => ({ id, name, stages });
const catalog: StageCatalog = { skills: [], executors: [] };

const ANSWER = flow("answer", "Answer", [stage("project"), stage("preview", { parent: "demo" }), stage("demo")]);
const PLUGIN = flow("plugin", "BB Plugin", [stage("task"), ref("nested", "answer"), stage("ship")]);

const open = () => {
  const settings: FlowSettings = { flows: [PLUGIN, ANSWER], minButtonWidth: 170 };
  return renderSlot<PluginNavPanelProps, typeof flowSettingsRpcContract>(app.navPanels.find((p) => p.id === "flows")!, { subPath: "plugin" }, {
    rpc: { getFlowSettings: () => settings, saveFlowSettings: (input: unknown) => input, getStageCatalog: () => catalog, getRootSkill: () => null } as never,
    settings: { language: "Русский" },
  });
};

describe("номера этапов вложенного flow на странице Flow", () => {
  it("строка flow — номер этапа, её этапы — с точкой, под-этап без номера, следующий этап — номер после flow", async () => {
    const slot = open();
    await slot.findByRole("row", { name: "Этап 1" });
    const numbers = slot.getAllByRole("row").slice(1).map((row) => row.querySelector('[role="cell"]')?.textContent?.trim() ?? "");
    expect(numbers).toEqual(["1", "2", "2.1", "", "2.2", "3"]);
  });
});
