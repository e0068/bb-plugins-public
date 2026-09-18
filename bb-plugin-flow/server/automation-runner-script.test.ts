// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import type { StepOutcome, Steps } from "../packages/automation-steps/index";
import { STEP_IDS } from "../packages/automation-steps/catalog";
import { stage } from "../core/stages-fixtures";
import type { StageSettings, WorkStage } from "../shared/contract";
import { createAutomationRunner } from "./automation-runner";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_script";
const T0 = "2026-09-17T10:00:00.000Z";
type Script = { id: string; name: string; content: string };

const setup = (automation: NonNullable<WorkStage["automation"]>, script: (threadId: string, s: Script) => Promise<StepOutcome>) => {
  const calls: string[] = [];
  const steps = Object.fromEntries(STEP_IDS.map((id) => [id, async () => (calls.push(id), { ok: true, detail: null })])) as unknown as Steps;
  const settings: StageSettings = { stages: [stage("review"), { id: "ship", kind: "skill", skill: "", name: "Ship", executors: [], automation }], minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const thread = async () => ({ active: false, providerId: "claude-code", environmentId: null });
  let advance: (threadId: string) => void = () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
  const runner = createAutomationRunner({ progress, store: createStore(bb.storage.kv), stages: () => settings, steps, external: async () => ({ ok: true, detail: null }), script, thread, providers: async () => [], kv: bb.storage.kv, plugins: { list: async () => ({ plugins: [] }), applyUpdate: async () => undefined, install: async () => undefined, remove: async () => undefined }, now: () => T0, onError: (e) => { throw e; } });
  advance = (threadId) => void runner.advance(threadId);
  registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread });
  const view = async () => (await harness.callRpc("getFlowProgress", { threadId: THREAD })) as { stages: Array<{ id: string; state: string; automation?: { steps: Array<{ label: string; state: string; error: string | null }> } }> };
  const finishReview = async () => {
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "started" }, { threadId: THREAD });
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
  };
  return { calls, view, finishReview };
};

describe("шаг-скрипт в прогоне автоматизации", () => {
  it("скрипт исполняется по порядку между шагами Flow со своим содержимым", async () => {
    const ran: Array<[string, Script]> = [];
    const order: string[] = [];
    const script = { id: "1", name: "notify.sh", content: "echo hi" };
    const { calls, view, finishReview } = setup({ source: "flow", steps: ["git.commit", "script:1", "git.create-pr"], scripts: [script] }, async (threadId, s) => {
      ran.push([threadId, s]);
      order.push(`script:${s.id}`);
      return { ok: true, detail: "hi" };
    });
    await finishReview();
    await vi.waitFor(async () => expect((await view()).stages.find((s) => s.id === "ship")?.state).toBe("done"));
    expect(ran).toEqual([[THREAD, script]]);
    expect(calls).toEqual(["git.commit", "git.create-pr"]);
    expect((await view()).stages.find((s) => s.id === "ship")?.automation?.steps.map((s) => s.label)).toEqual(["Commit", "notify.sh", "Open a PR"]);
  });

  it("упавший скрипт останавливает цепочку с его ошибкой", async () => {
    const { calls, view, finishReview } = setup({ source: "flow", steps: ["script:1", "git.create-pr"], scripts: [{ id: "1", name: "a.sh", content: "exit 1" }] }, async () => ({ ok: false, error: "The script a.sh exited with code 1:" }));
    await finishReview();
    await vi.waitFor(async () => expect((await view()).stages.find((s) => s.id === "ship")?.state).toBe("fail"));
    expect((await view()).stages.find((s) => s.id === "ship")?.automation?.steps[0]).toMatchObject({ state: "fail", error: "The script a.sh exited with code 1:" });
    expect(calls).toEqual([]);
  });

  it("шаг-скрипт без скрипта в этапе — провал без запуска", async () => {
    const script = vi.fn(async () => ({ ok: true, detail: null }) as StepOutcome);
    const { view, finishReview } = setup({ source: "flow", steps: ["script:7"] }, script);
    await finishReview();
    await vi.waitFor(async () => expect((await view()).stages.find((s) => s.id === "ship")?.state).toBe("fail"));
    expect((await view()).stages.find((s) => s.id === "ship")?.automation?.steps[0]?.error).toBe("The script of this step is no longer in the stage.");
    expect(script).not.toHaveBeenCalled();
  });
});
