// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import type { StepId, StepOutcome, Steps } from "@bb-plugins/automation-steps/index";
import { STEP_IDS } from "@bb-plugins/automation-steps/catalog";
import { stage } from "../core/stages-fixtures";
import type { StageSettings, WorkStage } from "../shared/contract";
import { createAutomationRunner } from "./automation-runner";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_cancel";
const T0 = "2026-10-01T10:00:00.000Z";

const land: WorkStage = { id: "land", kind: "skill", skill: "", name: "land", executors: [], automation: { source: "flow", steps: ["git.merge", "bb.archive"] } };

/** Шаги-фейки: `git.merge` отвечает тем, что вернёт `merge`; каждый вызов пишется по порядку. */
const fakeSteps = (merge: () => Promise<StepOutcome>) => {
  const calls: StepId[] = [];
  const steps = Object.fromEntries(
    STEP_IDS.map((id) => [
      id,
      async (): Promise<StepOutcome> => {
        calls.push(id);
        return id === "git.merge" ? merge() : { ok: true, detail: null };
      },
    ]),
  ) as unknown as Steps;
  return { steps, calls };
};

const manualTimers = () => {
  const pending: Array<{ run: () => void; cancelled: boolean }> = [];
  const schedule = (run: () => void) => {
    const timer = { run, cancelled: false };
    pending.push(timer);
    return () => void (timer.cancelled = true);
  };
  const live = () => pending.filter((t) => !t.cancelled);
  const fire = () => live().forEach((t) => ((t.cancelled = true), t.run()));
  return { schedule, live, fire };
};

const setup = (steps: Steps) => {
  const settings: StageSettings = { stages: [stage("review"), land], minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  let advance: (threadId: string) => void = () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
  const thread = async () => ({ active: true, providerId: "claude-code", environmentId: null });
  const plugins = { list: async () => ({ plugins: [] }), applyUpdate: async () => undefined, install: async () => undefined, remove: async () => undefined };
  const timers = manualTimers();
  const runner = createAutomationRunner({ progress, store: createStore(bb.storage.kv), stages: () => settings, steps, external: async () => ({ ok: true as const, detail: null }), thread, providers: async () => [], kv: bb.storage.kv, plugins, now: () => T0, retry: () => ({ seconds: 30, attempts: 3 }), schedule: timers.schedule, onError: () => undefined });
  advance = (threadId) => void runner.advance(threadId);
  registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread });
  const start = () => harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
  return { runner, progress, timers, start };
};

describe("отмена flow останавливает автоматизации треда", () => {
  it("назначенный автоповтор снимается и не срабатывает", async () => {
    const { steps, calls } = fakeSteps(async () => ({ ok: false, error: "timed out" }));
    const { runner, progress, timers, start } = setup(steps);
    await start();
    await vi.waitFor(() => expect(timers.live()).toHaveLength(1));
    runner.cancel(THREAD);
    await progress.remove(THREAD);
    expect(timers.live()).toEqual([]);
    timers.fire();
    expect(calls).toEqual(["git.merge"]);
  });

  it("шаг, закончившийся после отмены, прогон не заводит и дальше не идёт", async () => {
    let finish: (outcome: StepOutcome) => void = () => undefined;
    const { steps, calls } = fakeSteps(() => new Promise((resolve) => (finish = resolve)));
    const { runner, progress, start } = setup(steps);
    await start();
    await vi.waitFor(() => expect(calls).toEqual(["git.merge"]));
    runner.cancel(THREAD);
    await progress.remove(THREAD);
    finish({ ok: true, detail: null });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await progress.get(THREAD)).toBeNull();
    expect(calls).toEqual(["git.merge"]);
  });

  it("новый прогон после отмены идёт как обычно", async () => {
    const { steps, calls } = fakeSteps(async () => ({ ok: true, detail: null }));
    const { runner, start, progress } = setup(steps);
    runner.cancel(THREAD);
    await start();
    await vi.waitFor(async () => expect((await progress.get(THREAD))?.stages.land?.finishedAt).toBe(T0));
    expect(calls).toEqual(["git.merge", "bb.archive"]);
  });
});
