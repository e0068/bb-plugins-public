// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { FlowSettings } from "../shared/contract";
import { createFlowSettings } from "./flow-settings";
import { READ_FLOWS_TOOL_NAME, registerFlowTools, SAVE_FLOW_TOOL_NAME } from "./flow-tools";
import { registerFlowSettingsApi, STAGE_SETTINGS_CHANNEL } from "./settings-api";

const textOf = (result: unknown): string => ((result as { content: Array<{ text?: string }> }).content ?? []).map((p) => p.text ?? "").join("\n");
const isError = (result: unknown): boolean => (result as { isError?: boolean }).isError === true;

const setup = async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const settings = await createFlowSettings(bb.storage.kv);
  const catalog = async () => ({ skills: [{ name: "task-flow" }, { name: "practice" }], executors: [] });
  registerFlowSettingsApi(bb, settings, { catalog, rootSkill: async () => null, skillFile: async () => null, reveal: async () => ({ revealed: false, error: null }) });
  registerFlowTools(bb, settings, { catalog, newId: () => "new1" });
  const flows = () => harness.callRpc("getFlowSettings", {}) as Promise<FlowSettings>;
  return { harness, flows };
};

describe("инструмент read_flows", () => {
  it("отдаёт flow по порядку, навыки и исполнителей каталога и шаги автоматизаций", async () => {
    const { harness } = await setup();
    const result = await harness.callAgentTool(READ_FLOWS_TOOL_NAME, {}, { threadId: "thr_1" });
    const read = JSON.parse(textOf(result));
    expect(read.flows.map((f: { id: string }) => f.id)).toEqual(["default"]);
    expect(read.skills).toEqual(["practice", "task-flow"]);
    expect(read.executors).toEqual([]);
    expect(read.steps).toContainEqual({ id: "git.commit", label: "Commit" });
  });
});

describe("инструмент save_flow", () => {
  it("новый flow с позицией 0 становится первым, прежние не меняются, открытая страница получает сигнал", async () => {
    const { harness, flows } = await setup();
    const before = await flows();
    const result = await harness.callAgentTool(SAVE_FLOW_TOOL_NAME, { name: "General", position: 0, stages: [{ kind: "questions" }, { kind: "skill", skill: "practice" }] }, { threadId: "thr_1" });
    expect(isError(result)).toBe(false);
    const after = await flows();
    expect(after.flows.map((f) => f.id)).toEqual(["flow-new1", "default"]);
    expect(after.flows[1]).toEqual(before.flows[0]);
    expect(harness.realtimeSignals.map((s) => s.channel)).toContain(STAGE_SETTINGS_CHANNEL);
    expect(textOf(result)).toContain("flow-new1");
  });

  it("flow с навыком не из каталога отклоняется ошибкой с проблемой, коллекция не меняется", async () => {
    const { harness, flows } = await setup();
    const before = await flows();
    const result = await harness.callAgentTool(SAVE_FLOW_TOOL_NAME, { name: "General", stages: [{ kind: "skill", skill: "made-up" }] }, { threadId: "thr_1" });
    expect(isError(result)).toBe(true);
    expect(textOf(result)).toMatch(/made-up/);
    expect(await flows()).toEqual(before);
    expect(harness.realtimeSignals.map((s) => s.channel)).not.toContain(STAGE_SETTINGS_CHANNEL);
  });

  it("flow, не прошедший схему, отклоняется, коллекция не меняется", async () => {
    const { harness, flows } = await setup();
    const before = await flows();
    const result = await harness.callAgentTool(SAVE_FLOW_TOOL_NAME, { name: "", stages: [] }, { threadId: "thr_1" }).catch((error: unknown) => ({ isError: true, content: [{ text: String(error) }] }));
    expect(isError(result)).toBe(true);
    expect(await flows()).toEqual(before);
  });
});
