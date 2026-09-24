// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import type { StepId, StepOutcome, Steps } from "../packages/automation-steps/index";
import { STEP_IDS } from "../packages/automation-steps/catalog";
import { stage } from "../core/stages-fixtures";
import { actionStage } from "../lib/stage-constants";
import type { StageSettings, WorkStage } from "../shared/contract";
import { createAutomationRunner, registerAutomationRunner } from "./automation-runner";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_wake_auto";
const T0 = "2026-09-18T10:00:00.000Z";

const flowStage = (id: string, name: string, steps: StepId[]): WorkStage => ({ id, kind: "skill", skill: "", name, executors: [], automation: { source: "flow", steps } });
const action = (id: string, name: string, steps: StepId[]): WorkStage => ({ ...actionStage([]), id, name, automation: { source: "flow", steps } });

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

/** Шаги-фейки: отвечают по сценарию, по умолчанию успехом. */
const fakeSteps = (answer: (id: StepId) => StepOutcome = () => ({ ok: true, detail: null })) =>
  Object.fromEntries(STEP_IDS.map((id) => [id, async () => answer(id)])) as unknown as Steps;

/** Плагин на фейковом хосте с подвижными часами: реплики агенту копятся в `sent`, время двигает `tick`. */
const setup = (stages: WorkStage[], steps: Steps) => {
  const settings: StageSettings = { stages, minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  const sent: string[] = [];
  let clock = Date.parse(T0);
  const now = () => new Date(clock).toISOString();
  let advance: (threadId: string) => void = () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
  const thread = async () => ({ active: false, providerId: "claude-code", environmentId: null });
  const plugins = { list: async () => ({ plugins: [] }), applyUpdate: async () => undefined, install: async () => undefined, remove: async () => undefined };
  const runner = createAutomationRunner({
    progress,
    store,
    stages: () => settings,
    steps,
    external: async () => ({ ok: true, detail: null }),
    thread,
    providers: async () => [],
    wake: async (_threadId, text) => void sent.push(text),
    kv: bb.storage.kv,
    plugins,
    now,
    onError: (error) => {
      throw error;
    },
  });
  advance = (threadId) => void runner.advance(threadId);
  registerProgress(bb, progress, { now, stages: () => settings, windowCost: async () => undefined, thread });
  registerAutomationRunner(bb, runner);
  const view = () => harness.callRpc("getFlowProgress", { threadId: THREAD }) as Promise<{ stages: Array<{ id: string; state: string; minutes: number | null; idleMinutes?: number | null }> } | null>;
  const rowOf = async (id: string) => (await view())?.stages.find((s) => s.id === id);
  const mark = (id: string, state: "started" | "done") => harness.callAgentTool(FLOW_STAGE_TOOL, { stage: id, state }, { threadId: THREAD });
  return { harness, store, view, rowOf, mark, sent, tick: (minutes: number) => void (clock += minutes * 60_000) };
};

const code = stage("code", { name: "Реализация" });
const demo = { ...stage("demo", { name: "Демонстрация" }), kind: "demo" as const };

describe("доигранная цепочка автоматизаций будит агента", () => {
  it("за автоматизацией идёт этап агента — реплика уходит", async () => {
    const { mark, rowOf, sent } = setup([code, flowStage("publish", "Commit, FF to Main, PR", ["git.commit", "git.create-pr"]), demo], fakeSteps());
    await mark("code", "started");
    await mark("code", "done");
    await vi.waitFor(async () => expect((await rowOf("publish"))?.state).toBe("done"), { timeout: 5000 });
    await vi.waitFor(() => expect(sent).toHaveLength(1), { timeout: 5000 });
    expect(sent[0]).toContain("carry on with the next stage");
  });

  it("две автоматизации подряд будят один раз, после последней", async () => {
    const { mark, rowOf, sent } = setup([code, flowStage("publish", "PR", ["git.create-pr"]), flowStage("land", "Merge", ["git.merge"]), demo], fakeSteps());
    await mark("code", "done");
    await vi.waitFor(async () => expect((await rowOf("land"))?.state).toBe("done"), { timeout: 5000 });
    await vi.waitFor(() => expect(sent).toHaveLength(1), { timeout: 5000 });
  });

  it("автоматизация последняя во flow — реплики нет", async () => {
    const { mark, rowOf, sent } = setup([code, flowStage("land", "Merge", ["git.merge"])], fakeSteps());
    await mark("code", "done");
    await vi.waitFor(async () => expect((await rowOf("land"))?.state).toBe("done"), { timeout: 5000 });
    expect(sent).toEqual([]);
  });

  it("за автоматизацией идёт этап Action — реплики нет, Flow ждёт нажатия", async () => {
    const { mark, rowOf, sent } = setup([code, flowStage("publish", "PR", ["git.create-pr"]), action("press", "Publish", ["bb.tasks-in-review"]), demo], fakeSteps());
    await mark("code", "done");
    await vi.waitFor(async () => expect((await rowOf("publish"))?.state).toBe("done"), { timeout: 5000 });
    expect(sent).toEqual([]);
  });

  it("упавший шаг реплики не даёт", async () => {
    const { mark, rowOf, sent } = setup([code, flowStage("publish", "PR", ["git.create-pr"]), demo], fakeSteps(() => ({ ok: false, error: "no token" })));
    await mark("code", "done");
    await vi.waitFor(async () => expect((await rowOf("publish"))?.state).toBe("fail"), { timeout: 5000 });
    expect(sent).toEqual([]);
  });

  it("отметка этапа, за которым автоматизации нет, агента не будит", async () => {
    const { mark, sent } = setup([code, demo], fakeSteps());
    await mark("code", "started");
    await mark("code", "done");
    expect(sent).toEqual([]);
  });
});

describe("простой сломанной автоматизации", () => {
  /** Шаг падает первый раз и проходит после повтора. */
  const flaky = () => {
    let refuse = true;
    return { steps: fakeSteps(() => (refuse ? { ok: false, error: "no token" } : { ok: true, detail: null })), fix: () => void (refuse = false) };
  };

  it("ожидание владельца не идёт в минуты этапа и названо в реплике агенту", async () => {
    const { steps, fix } = flaky();
    const { mark, rowOf, sent, tick, harness } = setup([code, flowStage("publish", "Commit, FF to Main, PR", ["git.create-pr"]), demo], steps);
    await mark("code", "done");
    await vi.waitFor(async () => expect((await rowOf("publish"))?.state).toBe("fail"), { timeout: 5000 });
    tick(616);
    fix();
    expect(await harness.callRpc("retryAutomation", { threadId: THREAD, stage: "publish" })).toEqual({ started: true });
    await vi.waitFor(async () => expect((await rowOf("publish"))?.state).toBe("done"), { timeout: 5000 });
    expect(await rowOf("publish")).toMatchObject({ minutes: 0, idleMinutes: 616 });
    await vi.waitFor(() => expect(sent).toHaveLength(1), { timeout: 5000 });
    expect(sent[0]).toContain("Commit, FF to Main, PR — 616 m");
  });

  it("ожидание нажатия на этапе Action не идёт в минуты этапа", async () => {
    const { mark, rowOf, tick, harness } = setup([code, action("press", "Publish", ["bb.tasks-in-review"]), demo], fakeSteps());
    await mark("code", "done");
    await vi.waitFor(async () => expect((await rowOf("press"))?.state).toBe("now"), { timeout: 5000 });
    tick(40);
    expect(await harness.callRpc("runActionStep", { threadId: THREAD, stage: "press" })).toEqual({ started: true });
    await vi.waitFor(async () => expect((await rowOf("press"))?.state).toBe("done"), { timeout: 5000 });
    expect(await rowOf("press")).toMatchObject({ minutes: 0, idleMinutes: 40 });
  });

  it("простой назван и в ответе инструмента отметки этапа — оттуда он уходит в отчёт", async () => {
    const { steps, fix } = flaky();
    const { mark, rowOf, tick, harness } = setup([code, flowStage("publish", "Commit, FF to Main, PR", ["git.create-pr"]), stage("report", { name: "Отчёт" })], steps);
    await mark("code", "done");
    await vi.waitFor(async () => expect((await rowOf("publish"))?.state).toBe("fail"), { timeout: 5000 });
    tick(616);
    fix();
    await harness.callRpc("retryAutomation", { threadId: THREAD, stage: "publish" });
    await vi.waitFor(async () => expect((await rowOf("publish"))?.state).toBe("done"), { timeout: 5000 });
    await mark("report", "started");
    const answer = textOf(await mark("report", "done"));
    expect(answer).toContain("Commit, FF to Main, PR — 616 m");
    expect(answer).toContain("flow report");
  });

  it("прогон без простоя ничего лишнего в ответ инструмента не пишет", async () => {
    const { mark, rowOf } = setup([code, flowStage("publish", "PR", ["git.create-pr"]), stage("report", { name: "Отчёт" })], fakeSteps());
    await mark("code", "done");
    await vi.waitFor(async () => expect((await rowOf("publish"))?.state).toBe("done"), { timeout: 5000 });
    expect(textOf(await mark("report", "done"))).not.toContain("Idle");
  });
});
