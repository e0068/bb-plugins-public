// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import type { StepId, StepOutcome, Steps } from "@bb-plugins/automation-steps/index";
import { STEP_IDS } from "@bb-plugins/automation-steps/catalog";
import { stage } from "../core/stages-fixtures";
import type { StageSettings, WorkStage } from "../shared/contract";
import { createAutomationRunner, registerAutomationRunner, type RunnerNotice } from "./automation-runner";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

// В треде Mail владелец жал «Пропустить» у упавшего шага, а сервер отказывал
// молча, пока Flow держал тред попыткой автоповтора. Пропуск, нажатый во время
// попытки, теперь принимается и применяется, когда попытка закончится.

const THREAD = "thr_skip";
const T0 = "2026-10-01T10:00:00.000Z";

const land: WorkStage = { id: "land", kind: "skill", skill: "", name: "land", executors: [], automation: { source: "flow", steps: ["git.merge", "bb.archive"] } };
const review = stage("review");

/** `git.merge` падает сразу, а каждая следующая попытка ждёт, пока тест её не отпустит с нужным итогом; `hold` — какие ещё шаги ждут. */
const heldMerge = (hold: StepId[] = []) => {
  const calls: StepId[] = [];
  const held: Array<(outcome: StepOutcome) => void> = [];
  const steps = Object.fromEntries(
    STEP_IDS.map((id) => [
      id,
      async (): Promise<StepOutcome> => {
        calls.push(id);
        if (id !== "git.merge" && !hold.includes(id)) return { ok: true, detail: null };
        if (id === "git.merge" && calls.filter((c) => c === "git.merge").length === 1) return { ok: false, error: "not mergeable" };
        return new Promise<StepOutcome>((resolve) => held.push(resolve));
      },
    ]),
  ) as unknown as Steps;
  const release = (outcome: StepOutcome) => held.shift()?.(outcome);
  return { steps, calls, held, release };
};

const setup = (steps: Steps) => {
  const settings: StageSettings = { stages: [review, land], minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  let advance: (threadId: string) => void = () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
  const thread = async () => ({ active: true, providerId: "claude-code", environmentId: null });
  const plugins = { list: async () => ({ plugins: [] }), applyUpdate: async () => undefined, install: async () => undefined, remove: async () => undefined };
  const timers: Array<{ run: () => void; cancelled: boolean }> = [];
  const schedule = (run: () => void) => {
    const timer = { run, cancelled: false };
    timers.push(timer);
    return () => void (timer.cancelled = true);
  };
  const live = () => timers.filter((t) => !t.cancelled);
  const fire = () => live().forEach((t) => ((t.cancelled = true), t.run()));
  const notices: RunnerNotice[] = [];
  const store = createStore(bb.storage.kv);
  const runner = createAutomationRunner({ notify: (notice) => void notices.push(notice), progress, store, stages: () => settings, steps, external: async () => ({ ok: true as const, detail: null }), thread, providers: async () => [], kv: bb.storage.kv, plugins, now: () => T0, retry: () => ({ seconds: 30, attempts: 10 }), schedule, onError: (error: unknown) => { throw error; } });
  advance = (threadId) => void runner.advance(threadId);
  registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread });
  registerAutomationRunner(bb, runner);
  type Step = { state: string; skipQueued: boolean };
  const view = () => harness.callRpc("getFlowProgress", { threadId: THREAD }) as Promise<{ stages: Array<{ id: string; state: string; automation?: { steps: Step[] } }> } | null>;
  const landOf = async () => (await view())?.stages.find((s) => s.id === "land");
  const start = () => harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
  return { harness, live, fire, landOf, start, notices, awaiting: () => store.listAwaiting() };
};

/** Шаг упал, срок автоповтора вышел, попытка идёт и держит тред. */
const attemptRunning = async (held: unknown[], { live, fire, landOf, start }: ReturnType<typeof setup>) => {
  await start();
  await vi.waitFor(async () => expect((await landOf())?.state).toBe("fail"));
  expect(live()).toHaveLength(1);
  fire();
  await vi.waitFor(() => expect(held).toHaveLength(1));
};

describe("«Пропустить» во время попытки автоповтора", () => {
  it("принимается, а когда попытка падает, шаг закрывается без нового повтора, и цепочка идёт дальше", async () => {
    const { steps, calls, held, release } = heldMerge();
    const ctx = setup(steps);
    await attemptRunning(held, ctx);
    expect(await ctx.harness.callRpc("skipAutomationStep", { threadId: THREAD, stage: "land" })).toEqual({ started: true });
    expect((await ctx.landOf())?.automation?.steps[0]).toMatchObject({ state: "now", skipQueued: true });
    release({ ok: false, error: "not mergeable" });
    await vi.waitFor(async () => expect((await ctx.landOf())?.state).toBe("done"));
    expect(ctx.live()).toEqual([]);
    expect(calls).toEqual(["git.merge", "git.merge", "bb.archive"]);
  });

  it("попытка прошла — шаг закрыт её успехом, пропускать нечего", async () => {
    const { steps, calls, held, release } = heldMerge();
    const ctx = setup(steps);
    await attemptRunning(held, ctx);
    expect(await ctx.harness.callRpc("skipAutomationStep", { threadId: THREAD, stage: "land" })).toEqual({ started: true });
    release({ ok: true, detail: null });
    await vi.waitFor(async () => expect((await ctx.landOf())?.state).toBe("done"));
    expect(calls).toEqual(["git.merge", "git.merge", "bb.archive"]);
  });

  it("попытка прошла, идёт следующий шаг — «Пропустить» с устаревшего тоста отказывает, и упавший следующий шаг повторяется как обычно", async () => {
    const { steps, calls, held, release } = heldMerge(["bb.archive"]);
    const ctx = setup(steps);
    await attemptRunning(held, ctx);
    release({ ok: true, detail: null });
    await vi.waitFor(() => expect(held).toHaveLength(1));
    expect(await ctx.harness.callRpc("skipAutomationStep", { threadId: THREAD, stage: "land" })).toEqual({ started: false });
    release({ ok: false, error: "archive failed" });
    await vi.waitFor(async () => expect((await ctx.landOf())?.state).toBe("fail"));
    expect(ctx.live()).toHaveLength(1);
    expect(calls).toEqual(["git.merge", "git.merge", "bb.archive"]);
  });

  it("упавшая попытка с запомненным пропуском не ставит тред ждать владельца и не шлёт «шаг упал»", async () => {
    const { steps, held, release } = heldMerge();
    const ctx = setup(steps);
    await attemptRunning(held, ctx);
    await ctx.harness.callRpc("skipAutomationStep", { threadId: THREAD, stage: "land" });
    release({ ok: false, error: "not mergeable" });
    await vi.waitFor(async () => expect((await ctx.landOf())?.state).toBe("done"));
    expect(ctx.notices.filter((n) => n.kind === "failed")).toHaveLength(1);
    expect(await ctx.awaiting()).toEqual([]);
  });

  it("«Повторить» во время попытки отказывает и говорит, что тред занят", async () => {
    const { steps, held, release } = heldMerge();
    const ctx = setup(steps);
    await attemptRunning(held, ctx);
    expect(await ctx.harness.callRpc("retryAutomation", { threadId: THREAD, stage: "land" })).toEqual({ started: false, busy: true });
    release({ ok: true, detail: null });
    await vi.waitFor(async () => expect((await ctx.landOf())?.state).toBe("done"));
  });
});
