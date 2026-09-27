// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import type { StepId, StepOutcome, Steps } from "@bb-plugins/automation-steps/index";
import { STEP_IDS } from "@bb-plugins/automation-steps/catalog";
import type { RetryPolicy } from "../core/automation-run";
import { stage } from "../core/stages-fixtures";
import type { StageSettings, WorkStage } from "../shared/contract";
import { createAutomationRunner, registerAutomationRunner } from "./automation-runner";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_retry";
const T0 = "2026-09-25T10:00:00.000Z";

const flowStage = (id: string, steps: StepId[], kind: "skill" | "action" = "skill"): WorkStage => ({ id, kind, skill: "", name: id, executors: [], automation: { source: "flow", steps } });

/** Шаги-фейки: `git.merge` падает, пока `failing` не опустится до нуля; каждый вызов пишется по порядку. */
const flakyMerge = (failing: { left: number }) => {
  const calls: StepId[] = [];
  const steps = Object.fromEntries(
    STEP_IDS.map((id) => [
      id,
      async (): Promise<StepOutcome> => {
        calls.push(id);
        if (id !== "git.merge" || failing.left === 0) return { ok: true, detail: null };
        failing.left -= 1;
        return { ok: false, error: "timed out after 75 seconds" };
      },
    ]),
  ) as unknown as Steps;
  return { steps, calls };
};

/** Таймеры вручную: тест сам решает, когда срок вышел. */
const manualTimers = () => {
  const pending: Array<{ run: () => void; ms: number; cancelled: boolean }> = [];
  const schedule = (run: () => void, ms: number) => {
    const timer = { run, ms, cancelled: false };
    pending.push(timer);
    return () => void (timer.cancelled = true);
  };
  const live = () => pending.filter((t) => !t.cancelled);
  const fire = () => {
    const due = live();
    for (const t of due) t.cancelled = true;
    for (const t of due) t.run();
  };
  return { schedule, live, fire };
};

const setup = (stages: WorkStage[], steps: Steps, policy: { current: RetryPolicy }, now = () => T0) => {
  const settings: StageSettings = { stages, minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  let advance: (threadId: string) => void = () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
  const thread = async () => ({ active: true, providerId: "claude-code", environmentId: null });
  const plugins = { list: async () => ({ plugins: [] }), applyUpdate: async () => undefined, install: async () => undefined, remove: async () => undefined };
  const timers = manualTimers();
  const deps = { progress, store, stages: () => settings, steps, external: async () => ({ ok: true as const, detail: null }), thread, providers: async () => [], kv: bb.storage.kv, plugins, now, retry: () => policy.current, schedule: timers.schedule, onError: (error: unknown) => { throw error; } };
  const runner = createAutomationRunner(deps);
  advance = (threadId) => void runner.advance(threadId);
  registerProgress(bb, progress, { now, stages: () => settings, windowCost: async () => undefined, thread });
  registerAutomationRunner(bb, runner);
  type StepView = { state: string; retryAt: string | null };
  const view = () => harness.callRpc("getFlowProgress", { threadId: THREAD }) as Promise<{ stages: Array<{ id: string; state: string; automation?: { steps: StepView[] } }> } | null>;
  const stateOf = async (id: string) => (await view())?.stages.find((s) => s.id === id)?.state;
  const stepsOf = async (id: string) => (await view())?.stages.find((s) => s.id === id)?.automation?.steps ?? [];
  const start = () => harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
  return { harness, store, progress, timers, stateOf, stepsOf, start, runner, kv: bb.storage.kv };
};

const review = stage("review");
const land = flowStage("land", ["git.merge", "bb.archive"]);

describe("автоповтор упавшего шага автоматизации", () => {
  it("0 секунд — шаг ждёт владельца, таймера нет", async () => {
    const { steps, calls } = flakyMerge({ left: 1 });
    const { timers, stateOf, stepsOf, start, store } = setup([review, land], steps, { current: { seconds: 0, attempts: 0 } });
    await start();
    await vi.waitFor(async () => expect(await stateOf("land")).toBe("fail"));
    expect(timers.live()).toEqual([]);
    expect((await stepsOf("land"))[0]).toMatchObject({ state: "fail", retryAt: null });
    expect(calls).toEqual(["git.merge"]);
    expect(await store.listAwaiting()).toHaveLength(1);
  });

  it("N секунд — повтор назначен через N с, виден на шаге и по сроку продолжает цепочку", async () => {
    const { steps, calls } = flakyMerge({ left: 1 });
    const { timers, stateOf, stepsOf, start, store } = setup([review, land], steps, { current: { seconds: 30, attempts: 3 } });
    await start();
    await vi.waitFor(async () => expect(await stateOf("land")).toBe("fail"));
    expect(timers.live().map((t) => t.ms)).toEqual([30_000]);
    expect((await stepsOf("land"))[0]).toMatchObject({ state: "fail", retryAt: "2026-09-25T10:00:30.000Z" });
    timers.fire();
    await vi.waitFor(async () => expect(await stateOf("land")).toBe("done"));
    expect(calls).toEqual(["git.merge", "git.merge", "bb.archive"]);
    expect(await store.listAwaiting()).toEqual([]);
  });

  it("попытки кончились — шаг ждёт владельца", async () => {
    const { steps, calls } = flakyMerge({ left: 5 });
    const { timers, stateOf, stepsOf, start } = setup([review, land], steps, { current: { seconds: 10, attempts: 2 } });
    await start();
    for (let i = 0; i < 2; i += 1) {
      await vi.waitFor(() => expect(timers.live()).toHaveLength(1));
      timers.fire();
      await vi.waitFor(() => expect(calls).toHaveLength(i + 2));
    }
    await vi.waitFor(async () => expect((await stepsOf("land"))[0]).toMatchObject({ state: "fail", retryAt: null }));
    expect(timers.live()).toEqual([]);
    expect(await stateOf("land")).toBe("fail");
  });

  it("0 попыток — повторяет, пока не пройдёт", async () => {
    const { steps, calls } = flakyMerge({ left: 6 });
    const { timers, stateOf, start } = setup([review, land], steps, { current: { seconds: 1, attempts: 0 } });
    await start();
    for (let i = 0; i < 6; i += 1) {
      await vi.waitFor(() => expect(timers.live()).toHaveLength(1));
      timers.fire();
    }
    await vi.waitFor(async () => expect(await stateOf("land")).toBe("done"));
    expect(calls.filter((id) => id === "git.merge")).toHaveLength(7);
  });

  it("«Повторить» владельца снимает назначенный повтор", async () => {
    const failing = { left: 1 };
    const { steps, calls } = flakyMerge(failing);
    const { harness, timers, stateOf, start } = setup([review, land], steps, { current: { seconds: 30, attempts: 3 } });
    await start();
    await vi.waitFor(async () => expect(await stateOf("land")).toBe("fail"));
    expect(await harness.callRpc("retryAutomation", { threadId: THREAD, stage: "land" })).toEqual({ started: true });
    expect(timers.live()).toEqual([]);
    await vi.waitFor(async () => expect(await stateOf("land")).toBe("done"));
    expect(calls).toEqual(["git.merge", "git.merge", "bb.archive"]);
  });

  it("«Пропустить» снимает назначенный повтор, шаг больше не исполняется", async () => {
    const { steps, calls } = flakyMerge({ left: 1 });
    const { harness, timers, stateOf, start } = setup([review, land], steps, { current: { seconds: 30, attempts: 3 } });
    await start();
    await vi.waitFor(async () => expect(await stateOf("land")).toBe("fail"));
    expect(await harness.callRpc("skipAutomationStep", { threadId: THREAD, stage: "land" })).toEqual({ started: true });
    expect(timers.live()).toEqual([]);
    await vi.waitFor(async () => expect(await stateOf("land")).toBe("done"));
    expect(calls).toEqual(["git.merge", "bb.archive"]);
  });

  it("настройку выключили, пока шаг ждал, — повтора нет, срок снят", async () => {
    const policy = { current: { seconds: 30, attempts: 3 } };
    const { steps, calls } = flakyMerge({ left: 1 });
    const { timers, stateOf, stepsOf, start } = setup([review, land], steps, policy);
    await start();
    await vi.waitFor(async () => expect(await stateOf("land")).toBe("fail"));
    policy.current = { seconds: 0, attempts: 3 };
    timers.fire();
    await vi.waitFor(async () => expect((await stepsOf("land"))[0]).toMatchObject({ state: "fail", retryAt: null }));
    expect(calls).toEqual(["git.merge"]);
  });

  it("шаг этапа Action сам не повторяется — ни после нажатия, ни после «Повторить»", async () => {
    const { steps, calls } = flakyMerge({ left: 2 });
    const action = flowStage("press", ["git.merge"], "action");
    const { harness, timers, stateOf, stepsOf, start } = setup([review, action], steps, { current: { seconds: 30, attempts: 0 } });
    await start();
    await vi.waitFor(async () => expect(await stateOf("press")).toBe("now"));
    await harness.callRpc("runActionStep", { threadId: THREAD, stage: "press" });
    await vi.waitFor(async () => expect(await stateOf("press")).toBe("fail"));
    expect(timers.live()).toEqual([]);
    // «Повторить» на упавшем шаге Action идёт через исполнитель цепочки — и там шаг Action не получает автоповтора.
    expect(await harness.callRpc("retryAutomation", { threadId: THREAD, stage: "press" })).toEqual({ started: true });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    await vi.waitFor(async () => expect((await stepsOf("press"))[0]).toMatchObject({ state: "fail", retryAt: null }));
    expect(timers.live()).toEqual([]);
  });

  it("выгрузка плагина снимает таймеры, а срок в записи остаётся для следующей загрузки", async () => {
    const { steps } = flakyMerge({ left: 1 });
    const { runner, timers, stateOf, stepsOf, start } = setup([review, land], steps, { current: { seconds: 30, attempts: 3 } });
    await start();
    await vi.waitFor(async () => expect(await stateOf("land")).toBe("fail"));
    runner.dispose();
    expect(timers.live()).toEqual([]);
    expect((await stepsOf("land"))[0]?.retryAt).toBe("2026-09-25T10:00:30.000Z");
  });

  it("после загрузки плагина назначенный повтор ставится заново на остаток срока", async () => {
    const { steps, calls } = flakyMerge({ left: 0 });
    const clock = { now: "2026-09-25T10:00:20.000Z" };
    const { kv, timers, stateOf, runner } = setup([review, land], steps, { current: { seconds: 30, attempts: 3 } }, () => clock.now);
    const run = { steps: [{ id: "git.merge", label: "m" }, { id: "bb.archive", label: "a" }], at: 0, error: "timed out", retryAt: "2026-09-25T10:00:30.000Z" };
    await kv.set(`flow-progress:${THREAD}`, { stages: { review: { finishedAt: T0 }, land: { startedAt: T0, run } }, waiting: [] });
    // Процесс поднялся заново: таймеров прежнего нет, срок лежит только в записи прогона.
    await runner.resume(THREAD);
    expect(timers.live().map((t) => t.ms)).toEqual([10_000]);
    timers.fire();
    await vi.waitFor(async () => expect(await stateOf("land")).toBe("done"));
    expect(calls).toEqual(["git.merge", "bb.archive"]);
  });
});
