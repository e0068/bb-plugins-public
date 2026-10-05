// @vitest-environment node
// Переключатель «Реплика агенту после последней попытки» включён, а последняя попытка упала, пока вызов flow_stage ждал:
// реплика о падении приходит агенту в ответе инструмента, а в тред ничего не уходит.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { StepOutcome, Steps } from "@bb-plugins/automation-steps/index";
import { STEP_IDS } from "@bb-plugins/automation-steps/catalog";
import { stage } from "../core/stages-fixtures";
import type { StageSettings, WorkStage } from "../shared/contract";
import { createAgentRelay } from "./agent-relay";
import { createAutomationRunner } from "./automation-runner";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_waits_failure";
const T0 = "2026-10-03T18:00:00.000Z";

const land: WorkStage = { id: "land", kind: "skill", skill: "", name: "Commit, PR", executors: [], automation: { source: "flow", steps: ["git.create-pr"] } };
const demo: WorkStage = stage("demo", { kind: "demo", skill: "", name: "Демонстрация" });

const setup = (createPr: () => Promise<StepOutcome>, options: { waitMs?: number; agentActive?: boolean } = {}) => {
  const settings: StageSettings = { stages: [stage("review"), land, demo], minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  let advance: (threadId: string) => void = () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
  const steps = Object.fromEntries(STEP_IDS.map((id) => [id, id === "git.create-pr" ? createPr : async (): Promise<StepOutcome> => ({ ok: true, detail: null })])) as unknown as Steps;
  const thread = async () => ({ active: options.agentActive ?? true, providerId: "claude-code", environmentId: null });
  const sent: string[] = [];
  let relay = createAgentRelay({ busy: () => false, alive: async () => false, send: async () => undefined, onError: () => undefined });
  const runner = createAutomationRunner({
    progress,
    store: createStore(bb.storage.kv),
    stages: () => settings,
    steps,
    external: async () => ({ ok: true as const, detail: null }),
    thread,
    providers: async () => [],
    kv: bb.storage.kv,
    plugins: { list: async () => ({ plugins: [] }), applyUpdate: async () => undefined, install: async () => undefined, remove: async () => undefined },
    now: () => T0,
    retry: () => ({ seconds: 0, attempts: 0 }),
    wakeOnFailure: () => true,
    wake: (threadId, text) => relay.deliver(threadId, text),
    onError: () => undefined,
  });
  relay = createAgentRelay({ busy: (threadId) => runner.busy(threadId), alive: async () => (await thread()).active, send: async (_threadId, text) => void sent.push(text), onError: () => undefined, pollMs: 5 });
  advance = (threadId) => void runner.advance(threadId);
  registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread, startTimeoutMs: 200, relay, relayWaitMs: options.waitMs ?? 2000 });
  const markDone = async () => {
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "started" }, { threadId: THREAD });
    const answer = (await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD })) as { content: Array<{ text: string }> } | string;
    return typeof answer === "string" ? answer : answer.content.map((part) => part.text).join("");
  };
  return { markDone, sent };
};

describe("реплика о падении после последней попытки — в ответе ждущего вызова", () => {
  it("агент получает её в ответе flow_stage, тред остаётся без сообщения", async () => {
    const { markDone, sent } = setup(async () => ({ ok: false, error: "gh: rate limited" }));
    const answer = await markDone();
    expect(answer).toContain("failed after the last attempt: gh: rate limited");
    expect(answer).toContain("instead of a message in the thread");
    expect(sent).toEqual([]);
  });
});
