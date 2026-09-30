// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import type { FlowSettings } from "../shared/contract";
import { createFlowSettings, FLOW_SETTINGS_KEY } from "./flow-settings";
import { registerFlowTools, SAVE_FLOW_TOOL_NAME } from "./flow-tools";

const isError = (result: unknown): boolean => (result as { isError?: boolean }).isError === true;

const stored: FlowSettings = {
  flows: [{ id: "default", name: "Default", stages: [stage("task", { skill: "task-flow", name: "Task" }), stage("practice")] }],
  minButtonWidth: 170,
  version: 2,
};

const setup = async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  await bb.storage.kv.set(FLOW_SETTINGS_KEY, stored);
  const settings = await createFlowSettings(bb.storage.kv);
  registerFlowTools(bb, settings, { catalog: async () => ({ skills: [{ name: "practice" }], executors: [] }), newId: () => "new1" });
  return { harness, settings };
};

describe("save_flow на flow с этапом, чей навык пропал", () => {
  it("flow сохраняется: этап уже был в сохранённом flow", async () => {
    const { harness, settings } = await setup();
    const result = await harness.callAgentTool(
      SAVE_FLOW_TOOL_NAME,
      { id: "default", name: "Default", stages: [{ id: "task", kind: "skill", skill: "task-flow", name: "Task" }, { id: "practice", kind: "skill", skill: "practice" }, { kind: "demo" }] },
      { threadId: "thr_1" },
    );
    expect(isError(result)).toBe(false);
    expect(settings.current().flows[0]!.stages.map((s) => s.id)).toEqual(["task", "practice", "demo"]);
  });

  it("другому flow и новому flow этап чужого сохранённого flow навык не открывает", async () => {
    const { harness, settings } = await setup();
    const stages = [{ id: "task", kind: "skill", skill: "task-flow" }];
    expect(isError(await harness.callAgentTool(SAVE_FLOW_TOOL_NAME, { id: "flow-other", name: "Other", stages }, { threadId: "thr_1" }))).toBe(true);
    expect(isError(await harness.callAgentTool(SAVE_FLOW_TOOL_NAME, { name: "New", stages }, { threadId: "thr_1" }))).toBe(true);
    expect(settings.current()).toEqual(stored);
  });
});
