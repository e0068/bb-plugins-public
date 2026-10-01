// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import type { StepId, StepOutcome, Steps } from "@bb-plugins/automation-steps/index";
import { STEP_IDS } from "@bb-plugins/automation-steps/catalog";
import { onMark } from "../core/progress";
import { stage } from "../core/stages-fixtures";
import type { StageSettings, WorkStage } from "../shared/contract";
import { createAutomationRunner } from "./automation-runner";
import { FLOW_STAGE_TOOL, createProgress, registerProgress, type ProgressStore } from "./progress";
import { createStore } from "./store";

// Отметка этапа, пришедшая, пока Flow доделывает автоматизацию и ещё держит
// тред, не теряется: следующая автоматизация за отмеченным этапом начинается.
// Отметка подаётся во время N-го чтения прогресса после конца шага — на каждом
// из чтений, какие бы ни делал исполнитель, заканчивая работу.

const THREAD = "thr_wake";
const T0 = "2026-10-01T10:00:00.000Z";

const auto = (id: string, step: StepId): WorkStage => ({ id, kind: "skill", skill: "", name: id, executors: [], automation: { source: "flow", steps: [step] } });
const stages = [stage("review"), auto("auto1", "git.merge"), stage("review2"), auto("auto2", "bb.archive")];

const run = async (markOnRead: number) => {
  const settings: StageSettings = { stages, minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  let advance: (threadId: string) => void = () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
  const calls: StepId[] = [];
  let finishMerge: (outcome: StepOutcome) => void = () => undefined;
  const steps = Object.fromEntries(
    STEP_IDS.map((id) => [
      id,
      async (): Promise<StepOutcome> => {
        calls.push(id);
        return id === "git.merge" ? new Promise((resolve) => (finishMerge = resolve)) : { ok: true, detail: null };
      },
    ]),
  ) as unknown as Steps;
  // После конца шага auto1 каждое чтение прогресса считается; на `markOnRead`-м владелец отмечает review2.
  let reads: number | null = null;
  let marked = false;
  const markReview2 = () => progress.update(THREAD, (p) => onMark(onMark(p, "review2", "started", T0), "review2", "done", T0));
  const watched: ProgressStore = {
    ...progress,
    get: async (threadId) => {
      if (reads !== null && !marked && ++reads === markOnRead) {
        marked = true;
        await markReview2();
      }
      return progress.get(threadId);
    },
  };
  const thread = async () => ({ active: true, providerId: "claude-code", environmentId: null });
  const plugins = { list: async () => ({ plugins: [] }), applyUpdate: async () => undefined, install: async () => undefined, remove: async () => undefined };
  const runner = createAutomationRunner({ progress: watched, store: createStore(bb.storage.kv), stages: () => settings, steps, external: async () => ({ ok: true as const, detail: null }), thread, providers: async () => [], kv: bb.storage.kv, plugins, now: () => T0, onError: (error: unknown) => { throw error; } });
  advance = (threadId) => void runner.advance(threadId);
  registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread });
  await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
  await vi.waitFor(() => expect(calls).toEqual(["git.merge"]));
  reads = 0;
  finishMerge({ ok: true, detail: null });
  // Чтений меньше, чем `markOnRead`, — отметка приходит, когда тред уже свободен.
  await vi.waitFor(async () => expect((await progress.get(THREAD))?.stages.auto1?.finishedAt).toBeDefined());
  await new Promise((resolve) => setTimeout(resolve, 20));
  if (!marked) await markReview2();
  await vi.waitFor(() => expect(calls).toEqual(["git.merge", "bb.archive"]));
};

describe("отметка этапа, пока Flow заканчивает автоматизацию", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])("пришла во время чтения %i — следующая автоматизация начинается", async (n) => {
    await run(n);
  });
});
