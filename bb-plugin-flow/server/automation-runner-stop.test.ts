// @vitest-environment node
// BBPL-969: «Стоп» у идущей автоматизации — шаг-скрипт обрывается сразу, шаг без сигнала доходит до конца, следующие не стартуют;
// этап ждёт владельца без тоста и автоповтора, агент слышит, что остановил владелец, «Продолжить» доигрывает цепочку.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import type { StepOutcome, Steps } from "@bb-plugins/automation-steps/index";
import { STEP_IDS } from "@bb-plugins/automation-steps/catalog";
import { STOPPED_ERROR, stoppedWakeText } from "../core/automation-run";
import { stage } from "../core/stages-fixtures";
import type { AutomationScript, StageSettings, WorkStage } from "../shared/contract";
import { createAutomationRunner, registerAutomationRunner, type RunnerNotice } from "./automation-runner";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_stop";
const T0 = "2026-10-27T10:00:00.000Z";

type Deferred = { promise: Promise<StepOutcome>; resolve: (outcome: StepOutcome) => void };
const deferred = (): Deferred => {
  let resolve: (outcome: StepOutcome) => void = () => undefined;
  const promise = new Promise<StepOutcome>((r) => (resolve = r));
  return { promise, resolve };
};

type View = { stages: Array<{ id: string; state: string; automation?: { stopping?: boolean; stopped?: boolean; steps: Array<{ id: string; state: string; error: string | null }> } }> };

const setup = (automation: NonNullable<WorkStage["automation"]>, options: { held?: Partial<Record<string, Deferred>>; kind?: WorkStage["kind"] } = {}) => {
  const calls: string[] = [];
  const wakes: string[] = [];
  const notices: RunnerNotice[] = [];
  const signals: Array<AbortSignal | undefined> = [];
  const steps = Object.fromEntries(
    STEP_IDS.map((id) => [id, async (): Promise<StepOutcome> => (calls.push(id), options.held?.[id] === undefined ? { ok: true, detail: null } : options.held[id]!.promise)]),
  ) as unknown as Steps;
  // Скрипт слушает сигнал: без сигнала он не кончится никогда — как `sleep 30`.
  const script = (_threadId: string, s: AutomationScript, signal?: AbortSignal): Promise<StepOutcome> => {
    calls.push(`script:${s.id}`);
    signals.push(signal);
    return new Promise((resolve) => signal?.addEventListener("abort", () => resolve({ ok: false, error: STOPPED_ERROR })));
  };
  const ship: WorkStage = { id: "ship", kind: options.kind ?? "skill", skill: "", name: "Ship", executors: [], automation };
  const settings: StageSettings = { stages: [stage("review"), ship], minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  const thread = async () => ({ active: false, providerId: "claude-code", environmentId: null });
  let advance: (threadId: string) => void = () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
  const runner = createAutomationRunner({
    progress,
    store,
    stages: () => settings,
    steps,
    external: async () => ({ ok: true, detail: null }),
    script,
    thread,
    providers: async () => [],
    kv: bb.storage.kv,
    plugins: { list: async () => ({ plugins: [] }), applyUpdate: async () => undefined, install: async () => undefined, remove: async () => undefined },
    now: () => T0,
    retry: () => ({ seconds: 30, attempts: 3 }),
    wakeOnFailure: () => true,
    wake: async (_threadId, text) => void wakes.push(text),
    notify: (notice) => void notices.push(notice),
    onError: (e) => {
      throw e;
    },
  });
  advance = (threadId) => void runner.advance(threadId);
  registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread });
  registerAutomationRunner(bb, runner);
  const view = async () => (await harness.callRpc("getFlowProgress", { threadId: THREAD })) as View | null;
  const shipView = async () => (await view())?.stages.find((s) => s.id === "ship")!;
  const finishReview = async () => {
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "started" }, { threadId: THREAD });
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
  };
  const stop = () => harness.callRpc("stopAutomation", { threadId: THREAD, stage: "ship" }) as Promise<{ started: boolean }>;
  const proceed = () => harness.callRpc("retryAutomation", { threadId: THREAD, stage: "ship" }) as Promise<{ started: boolean }>;
  return { calls, wakes, notices, signals, shipView, finishReview, stop, proceed, store, runner };
};

const scripted = (): NonNullable<WorkStage["automation"]> => ({ source: "flow", steps: ["git.commit", "script:1", "git.create-pr"], scripts: [{ id: "1", name: "slow.sh", content: "sleep 30" }] });

describe("Стоп у идущей автоматизации", () => {
  it("шаг-скрипт обрывается сразу, следующий шаг не стартует, этап остановлен на скрипте", async () => {
    const { calls, signals, shipView, finishReview, stop } = setup(scripted());
    await finishReview();
    await vi.waitFor(() => expect(calls).toContain("script:1"));
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(await stop()).toEqual({ started: true });
    await vi.waitFor(async () => expect((await shipView()).automation?.stopped).toBe(true));
    const view = await shipView();
    expect(view.automation?.steps.map((s) => s.state)).toEqual(["done", "stop", "todo"]);
    expect(view.automation?.steps[1]?.error).toBe(STOPPED_ERROR);
    expect(calls).not.toContain("git.create-pr");
  });

  it("остановка — не падение: реплика агенту об остановке, этап ждёт владельца, ни тоста, ни автоповтора", async () => {
    const { calls, wakes, notices, shipView, finishReview, stop, store } = setup(scripted());
    await finishReview();
    await vi.waitFor(() => expect(calls).toContain("script:1"));
    await stop();
    await vi.waitFor(async () => expect((await shipView()).automation?.stopped).toBe(true));
    await vi.waitFor(() => expect(wakes).toHaveLength(1));
    const ship = { id: "ship", kind: "skill", skill: "", name: "Ship", executors: [], automation: scripted() } as WorkStage;
    expect(wakes[0]).toBe(stoppedWakeText(ship, "script:1"));
    expect(notices.filter((n) => n.kind === "failed")).toEqual([]);
    expect((await store.listAwaiting()).some((entry) => entry.threadId === THREAD && entry.kind === "automation")).toBe(true);
    expect((await shipView()).automation?.steps[1]).not.toHaveProperty("retryAt", expect.any(String));
  });

  it("шаг без сигнала доходит до конца под «останавливается», записан сделанным, остановлен следующий", async () => {
    const merge = deferred();
    const { calls, shipView, finishReview, stop } = setup({ source: "flow", steps: ["git.merge", "git.create-pr"] }, { held: { "git.merge": merge } });
    await finishReview();
    await vi.waitFor(() => expect(calls).toContain("git.merge"));
    expect(await stop()).toEqual({ started: true });
    await vi.waitFor(async () => expect((await shipView()).automation?.stopping).toBe(true));
    expect((await shipView()).automation?.steps.map((s) => s.state)).toEqual(["now", "todo"]);
    merge.resolve({ ok: true, detail: null });
    await vi.waitFor(async () => expect((await shipView()).automation?.stopped).toBe(true));
    const view = await shipView();
    expect(view.automation?.stopping).toBe(false);
    expect(view.automation?.steps.map((s) => s.state)).toEqual(["done", "stop"]);
    expect(calls).not.toContain("git.create-pr");
  });

  it("шаг без сигнала упал под остановкой — остановленным остаётся он сам, с его ошибкой", async () => {
    const merge = deferred();
    const { calls, shipView, finishReview, stop } = setup({ source: "flow", steps: ["git.merge", "git.create-pr"] }, { held: { "git.merge": merge } });
    await finishReview();
    await vi.waitFor(() => expect(calls).toContain("git.merge"));
    await stop();
    merge.resolve({ ok: false, error: "GitHub: not mergeable" });
    await vi.waitFor(async () => expect((await shipView()).automation?.stopped).toBe(true));
    expect((await shipView()).automation?.steps[0]).toMatchObject({ state: "stop", error: "GitHub: not mergeable" });
  });

  it("запрос между шагами не даёт начаться следующему", async () => {
    const commit = deferred();
    const { calls, shipView, finishReview, stop } = setup({ source: "flow", steps: ["git.commit", "git.create-pr"] }, { held: { "git.commit": commit } });
    await finishReview();
    await vi.waitFor(() => expect(calls).toContain("git.commit"));
    commit.resolve({ ok: true, detail: null });
    await stop();
    await vi.waitFor(async () => expect((await shipView()).automation?.stopped).toBe(true));
    expect((await shipView()).automation?.steps.map((s) => s.state)).toEqual(["done", "stop"]);
    expect(calls).not.toContain("git.create-pr");
  });

  it("«Продолжить» перезапускает остановленный шаг и доигрывает цепочку", async () => {
    const merge = deferred();
    const { calls, shipView, finishReview, stop, proceed } = setup({ source: "flow", steps: ["git.merge", "git.create-pr"] }, { held: { "git.merge": merge } });
    await finishReview();
    await vi.waitFor(() => expect(calls).toContain("git.merge"));
    await stop();
    merge.resolve({ ok: true, detail: null });
    await vi.waitFor(async () => expect((await shipView()).automation?.stopped).toBe(true));
    expect(await proceed()).toEqual({ started: true });
    await vi.waitFor(async () => expect((await shipView()).state).toBe("done"));
    expect(calls.filter((c) => c === "git.create-pr")).toHaveLength(1);
    expect((await shipView()).automation).toMatchObject({ stopped: false, stopping: false });
  });

  it("последний шаг успел закончиться — этап закрыт как обычно, реплики об остановке нет", async () => {
    const merge = deferred();
    const { calls, wakes, shipView, finishReview, stop } = setup({ source: "flow", steps: ["git.merge"] }, { held: { "git.merge": merge } });
    await finishReview();
    await vi.waitFor(() => expect(calls).toContain("git.merge"));
    await stop();
    merge.resolve({ ok: true, detail: null });
    await vi.waitFor(async () => expect((await shipView()).state).toBe("done"));
    expect(wakes.some((w) => w.includes("stopped by the owner"))).toBe(false);
  });

  it("этап не идёт — отказ без следа", async () => {
    const { shipView, stop } = setup({ source: "flow", steps: ["git.commit"] });
    expect(await stop()).toEqual({ started: false });
    expect((await shipView())?.automation?.stopping ?? false).toBe(false);
  });

  it("этап Action «Стоп» не принимает", async () => {
    const { finishReview, stop } = setup({ source: "flow", steps: ["git.commit"] }, { kind: "action" });
    await finishReview();
    expect(await stop()).toEqual({ started: false });
  });
});
