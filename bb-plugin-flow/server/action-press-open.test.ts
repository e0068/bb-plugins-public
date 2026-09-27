// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import type { StepId, Steps } from "@bb-plugins/automation-steps/index";
import { STEP_IDS } from "@bb-plugins/automation-steps/catalog";
import { stage } from "../core/stages-fixtures";
import { actionStage } from "../lib/stage-constants";
import type { StageSettings, WorkStage } from "../shared/contract";
import { createAutomationRunner } from "./automation-runner";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_press";
const T0 = "2026-09-26T10:00:00.000Z";

const action = (id: string, steps: StepId[]): WorkStage => ({ ...actionStage([]), id, name: id, automation: { source: "flow", steps } });

describe("нажатие на начатый этап Action", () => {
  it("работает, даже когда раньше него наступил другой Action", async () => {
    const calls: StepId[] = [];
    const steps = Object.fromEntries(STEP_IDS.map((id) => [id, async () => (calls.push(id), { ok: true, detail: null })])) as unknown as Steps;
    const stages = [stage("s1"), action("p1", ["git.commit"]), stage("s2"), action("p2", ["git.create-pr", "git.merge"])];
    const settings: StageSettings = { stages, minButtonWidth: 170 };
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    let advance: (threadId: string) => void = () => undefined;
    const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
    const thread = async () => ({ active: false, providerId: "claude-code", environmentId: null });
    const plugins = { list: async () => ({ plugins: [] }), applyUpdate: async () => undefined, install: async () => undefined, remove: async () => undefined };
    const runner = createAutomationRunner({ progress, store: createStore(bb.storage.kv), stages: () => settings, steps, external: async () => ({ ok: true, detail: null }), thread, providers: async () => [], kv: bb.storage.kv, plugins, now: () => T0, onError: (error) => { throw error; } });
    advance = (threadId) => void runner.advance(threadId);
    registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread, startTimeoutMs: 100 });
    const markDone = async (id: string) => {
      await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: id, state: "started" }, { threadId: THREAD });
      await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: id, state: "done" }, { threadId: THREAD });
    };
    const track = async (id: string) => (await progress.get(THREAD))?.stages[id];

    await markDone("s2");
    await vi.waitFor(async () => expect((await track("p2"))?.run).toBeDefined());
    await markDone("s1");
    await vi.waitFor(async () => expect((await track("p1"))?.run).toBeDefined());
    expect(await runner.runActionStep(THREAD, "p2")).toBe(true);
    await vi.waitFor(async () => expect((await track("p2"))?.run?.at).toBe(1));
    expect(calls).toEqual(["git.create-pr"]);
  });
});
