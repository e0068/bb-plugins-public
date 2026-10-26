// @vitest-environment node
// Отметка начала этапа с исполнителем «Тред Codex» заводит дочерний тред, а этап с исполнителем «сам» — нет (BBPL-965).
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import type { StageSettings } from "../shared/contract";
import { registerApi } from "./api";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import type { ProviderThreads } from "./provider-threads";
import { createStore } from "./store";

const THREAD = "thr_flowed";
const codex = { id: "thread:codex", kind: "thread" as const, name: "Тред Codex", provider: "codex" };
const settings: StageSettings = { stages: [stage("spec", { name: "Spec" }), stage("practice", { name: "Execution", skill: "code-standards-fp", executors: [codex] })], minButtonWidth: 170 };
const brief = {
  title: "Бриф",
  setup: {
    stages: [
      { id: "spec", state: "todo", recommended: true, share: { percent: 15, risk: -1 } },
      { id: "practice", state: "todo", recommended: true, executor: "thread:codex", share: { percent: 100, risk: 0 }, factors: { "thread:codex": { factor: 1, risk: 0 } } },
    ],
    criteria: [{ text: "Тред Codex выбирается", add: { target: 1, max: 2, risk: 1, minutes: 5 } }],
  },
  scope: "- тред Codex",
};

const run = async (executor: string) => {
  const calls: Array<Parameters<ProviderThreads["delegate"]>[0]> = [];
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  const progress = createProgress(bb.storage.kv);
  const now = () => "2026-10-26T10:00:00.000Z";
  registerAskTool(bb, store, { newId: () => "run", now, stages: () => settings, progress });
  registerApi(bb, store, { now, progress });
  const delegate: ProviderThreads["delegate"] = async (args) => {
    calls.push(args);
    return { kind: "created", threadId: "thr_codex" };
  };
  registerProgress(bb, progress, { now, stages: () => settings, windowCost: async () => 1, delegate });
  await harness.callAgentTool(ASK_TOOL_NAME, brief, { threadId: THREAD });
  const answer = { briefId: "dec_run", answers: [], stages: [{ id: "spec", run: true, executor: "self" }, { id: "practice", run: true, executor }] };
  await harness.callRpc("answerBrief", { id: "dec_run", messageId: "m", answer });
  await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "spec", state: "started" }, { threadId: THREAD });
  await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "spec", state: "done", results: [{ label: "spec.md", target: "docs/specs/spec.md" }] }, { threadId: THREAD });
  const reply = await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "practice", state: "started" }, { threadId: THREAD });
  const again = async () => JSON.stringify(await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "practice", state: "started" }, { threadId: THREAD }));
  return { calls, reply: JSON.stringify(reply), again };
};

describe("этап, отданный дочернему треду", () => {
  it("исполнитель «Тред Codex» — Flow заводит тред на Codex с результатами спеки, а агенту велит закончить ход", async () => {
    const { calls, reply } = await run("thread:codex");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ threadId: THREAD, providerId: "codex", stage: { id: "practice" }, results: [{ label: "spec.md", target: "docs/specs/spec.md" }] });
    expect(reply).toContain("@thread:thr_codex on codex");
    expect(reply).toContain("end your turn now");
  });

  it("доработка — повторное начало этапа второго треда не заводит, а велит передать правки прежнему", async () => {
    const { calls, again } = await run("thread:codex");
    const reply = await again();
    expect(calls).toHaveLength(1);
    expect(reply).toContain("does not start a second one");
  });

  it("исполнитель «сам» — дочернего треда нет", async () => {
    const { calls, reply } = await run("self");
    expect(calls).toHaveLength(0);
    expect(reply).not.toContain("@thread:");
  });
});
