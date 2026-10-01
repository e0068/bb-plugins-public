// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import type { StepId, StepOutcome, Steps } from "@bb-plugins/automation-steps/index";
import { STEP_IDS } from "@bb-plugins/automation-steps/catalog";
import { stage } from "../core/stages-fixtures";
import type { WorkStage } from "../shared/contract";
import { createAutomationRunner } from "./automation-runner";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_links";
const T0 = "2026-10-01T10:00:00.000Z";
const PR = { label: "PR #570", target: "https://github.com/e0068/bb-plugins/pull/570" };

const flowStage = (id: string, steps: StepId[]): WorkStage => ({ id, kind: "skill", skill: "", name: id, executors: [], automation: { source: "flow", steps } });

/** Шаг PR оставляет ссылку, остальные — нет. */
const steps = Object.fromEntries(
  STEP_IDS.map((id) => [id, async (): Promise<StepOutcome> => (id === "git.create-pr" ? { ok: true, detail: PR.target, links: [PR] } : { ok: true, detail: null })]),
) as unknown as Steps;

describe("ссылки шагов в прогрессе", () => {
  it("доигранная автоматизация показывает ссылку PR в своих итогах", async () => {
    const settings = { stages: [stage("review"), flowStage("publish", ["git.commit", "git.create-pr"])], minButtonWidth: 170 };
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    let advance: (threadId: string) => void = () => undefined;
    const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
    const thread = async () => ({ active: true, providerId: "claude-code", environmentId: null });
    const plugins = { list: async () => ({ plugins: [] }), applyUpdate: async () => undefined, install: async () => undefined, remove: async () => undefined };
    const runner = createAutomationRunner({
      progress,
      store: createStore(bb.storage.kv),
      stages: () => settings,
      steps,
      external: async () => ({ ok: true, detail: null }),
      thread,
      providers: async () => [],
      kv: bb.storage.kv,
      plugins,
      now: () => T0,
      onError: (error) => {
        throw error;
      },
    });
    advance = (threadId) => void runner.advance(threadId);
    registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread });
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "started" }, { threadId: THREAD });
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done", results: [{ label: "review.md", target: "docs/review.md" }] }, { threadId: THREAD });
    const publish = async () =>
      ((await harness.callRpc("getFlowProgress", { threadId: THREAD })) as { stages: Array<{ id: string; state: string; results: unknown[] }> } | null)?.stages.find((s) => s.id === "publish");
    await vi.waitFor(async () => expect((await publish())?.state).toBe("done"));
    expect((await publish())?.results).toEqual([PR]);
  });
});
