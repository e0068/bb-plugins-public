// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import type { StepId, StepOutcome, Steps } from "@bb-plugins/automation-steps/index";
import { STEP_IDS } from "@bb-plugins/automation-steps/catalog";
import type { RetryPolicy } from "../core/automation-run";
import { stage } from "../core/stages-fixtures";
import type { StageSettings, WorkStage } from "../shared/contract";
import { createAutomationRunner, type RunnerNotice } from "./automation-runner";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_notice";
const T0 = "2026-09-27T10:00:00.000Z";

const flowStage = (id: string, steps: StepId[]): WorkStage => ({ id, kind: "skill", skill: "", name: id, executors: [], automation: { source: "flow", steps } });
const actionStage = (id: string, steps: StepId[]): WorkStage => ({ id, kind: "action", skill: "", name: id, executors: [], automation: { source: "flow", steps } });

const stepsAnswering = (answer: (id: StepId) => StepOutcome): Steps =>
  Object.fromEntries(STEP_IDS.map((id) => [id, async () => answer(id)])) as unknown as Steps;

const rethrow = (error: unknown) => {
  throw error;
};

/** Автоповтор с таймерами вручную: `fire` запускает все назначенные повторы, `set` меняет настройку посреди ожидания. */
const manualRetry = (initial: RetryPolicy) => {
  let policy = initial;
  let pending: Array<() => void> = [];
  const schedule = (run: () => void) => {
    pending.push(run);
    return () => void (pending = pending.filter((r) => r !== run));
  };
  const fire = () => {
    const due = pending;
    pending = [];
    due.forEach((run) => run());
  };
  return { deps: { retry: () => policy, schedule }, armed: () => pending.length, fire, set: (next: RetryPolicy) => void (policy = next) };
};

const setup = (
  stages: WorkStage[],
  steps: Steps,
  notify: (event: RunnerNotice) => void,
  onError: (error: unknown) => void = rethrow,
  // Без своего расписания автоповтор выключен: упавший шаг сразу ждёт владельца, как и проверяют тесты без таймеров.
  retry: Partial<ReturnType<typeof manualRetry>["deps"]> = { retry: () => ({ seconds: 0, attempts: 3 }) },
) => {
  const settings: StageSettings = { stages, minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  let advance: (threadId: string) => void = () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
  const thread = async () => ({ active: true, providerId: "claude-code", environmentId: null });
  const plugins = { list: async () => ({ plugins: [] }), applyUpdate: async () => undefined, install: async () => undefined, remove: async () => undefined };
  const runner = createAutomationRunner({
    progress,
    store,
    stages: () => settings,
    steps,
    external: async () => ({ ok: true, detail: null }),
    thread,
    providers: async () => [],
    kv: bb.storage.kv,
    plugins,
    now: () => T0,
    notify,
    onError,
    ...retry,
  });
  advance = (threadId) => void runner.advance(threadId);
  registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread });
  const closeReview = () => harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
  return { runner, closeReview };
};

const review = stage("review");

describe("исполнитель сообщает об итоге этапа-автоматизации", () => {
  it("доигранный этап даёт одно событие done на каждый этап", async () => {
    const events: RunnerNotice[] = [];
    const { closeReview } = setup([review, flowStage("publish", ["git.commit", "git.create-pr"]), flowStage("land", ["git.merge"])], stepsAnswering(() => ({ ok: true, detail: null })), (e) => events.push(e));
    await closeReview();
    await vi.waitFor(() => expect(events).toHaveLength(2));
    expect(events.map((e) => [e.kind, e.threadId, e.stage.id])).toEqual([
      ["done", THREAD, "publish"],
      ["done", THREAD, "land"],
    ]);
  });

  it("упавший шаг даёт одно событие failed с id шага и ошибкой, и done за ним нет", async () => {
    const events: RunnerNotice[] = [];
    const answer = (id: StepId): StepOutcome => (id === "git.merge" ? { ok: false, error: "not mergeable" } : { ok: true, detail: null });
    const { closeReview } = setup([review, flowStage("land", ["git.commit", "git.merge", "bb.archive"])], stepsAnswering(answer), (e) => events.push(e));
    await closeReview();
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({ kind: "failed", threadId: THREAD, stepId: "git.merge", error: "not mergeable" });
    expect(events[0]?.stage.id).toBe("land");
  });

  it("повтор, дошедший до конца, сообщает done", async () => {
    const events: RunnerNotice[] = [];
    let refuse = true;
    const answer = (id: StepId): StepOutcome => (id === "git.merge" && refuse ? { ok: false, error: "busy" } : { ok: true, detail: null });
    const { runner, closeReview } = setup([review, flowStage("land", ["git.merge"])], stepsAnswering(answer), (e) => events.push(e));
    await closeReview();
    await vi.waitFor(() => expect(events).toHaveLength(1));
    refuse = false;
    expect(await runner.retry(THREAD, "land")).toEqual({ started: true });
    await vi.waitFor(() => expect(events.map((e) => e.kind)).toEqual(["failed", "done"]));
  });

  it("сбой получателя событий не останавливает цепочку", async () => {
    const calls: StepId[] = [];
    const steps = Object.fromEntries(
      STEP_IDS.map((id) => [
        id,
        async () => {
          calls.push(id);
          return { ok: true, detail: null };
        },
      ]),
    ) as unknown as Steps;
    const errors: unknown[] = [];
    const { closeReview } = setup(
      [review, flowStage("publish", ["git.commit"]), flowStage("land", ["git.merge"])],
      steps,
      () => {
        throw new Error("realtime is down");
      },
      (error) => errors.push(error),
    );
    await closeReview();
    await vi.waitFor(() => expect(calls).toEqual(["git.commit", "git.merge"]));
    await vi.waitFor(() => expect(errors).toHaveLength(2));
  });

  it("этап Action не шлёт событий: его шаги жмёт сам владелец", async () => {
    const events: RunnerNotice[] = [];
    const { runner, closeReview } = setup([review, actionStage("press", ["git.commit"])], stepsAnswering(() => ({ ok: true, detail: null })), (e) => events.push(e));
    await closeReview();
    await vi.waitFor(async () => expect(await runner.runActionStep(THREAD, "press")).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(events).toEqual([]);
  });

  it("падение, за которым Flow повторит шаг сам, молчит; тост — один, когда повторы кончились", async () => {
    const events: RunnerNotice[] = [];
    const timers = manualRetry({ seconds: 30, attempts: 2 });
    const { closeReview } = setup([review, flowStage("land", ["git.merge"])], stepsAnswering(() => ({ ok: false, error: "busy" })), (e) => events.push(e), rethrow, timers.deps);
    await closeReview();
    await vi.waitFor(() => expect(timers.armed()).toBe(1));
    timers.fire();
    await vi.waitFor(() => expect(timers.armed()).toBe(1));
    expect(events).toEqual([]);
    timers.fire();
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({ kind: "failed", stepId: "git.merge", error: "busy" });
    expect(timers.armed()).toBe(0);
  });

  it("автоповтор, дошедший до конца, сообщает только done", async () => {
    const events: RunnerNotice[] = [];
    let refuse = true;
    const timers = manualRetry({ seconds: 30, attempts: 3 });
    const answer = (id: StepId): StepOutcome => (id === "git.merge" && refuse ? { ok: false, error: "busy" } : { ok: true, detail: null });
    const { closeReview } = setup([review, flowStage("land", ["git.merge"])], stepsAnswering(answer), (e) => events.push(e), rethrow, timers.deps);
    await closeReview();
    await vi.waitFor(() => expect(timers.armed()).toBe(1));
    refuse = false;
    timers.fire();
    await vi.waitFor(() => expect(events.map((e) => e.kind)).toEqual(["done"]));
  });

  it("автоповтор выключили, пока шаг ждал, — шаг ждёт владельца, и тост о падении приходит один раз", async () => {
    const events: RunnerNotice[] = [];
    const timers = manualRetry({ seconds: 30, attempts: 5 });
    const { closeReview } = setup([review, flowStage("land", ["git.merge"])], stepsAnswering(() => ({ ok: false, error: "busy" })), (e) => events.push(e), rethrow, timers.deps);
    await closeReview();
    await vi.waitFor(() => expect(timers.armed()).toBe(1));
    expect(events).toEqual([]);
    timers.set({ seconds: 0, attempts: 5 });
    timers.fire();
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({ kind: "failed", stepId: "git.merge", error: "busy" });
    expect(events[0]?.stage.id).toBe("land");
    expect(timers.armed()).toBe(0);
  });
});
