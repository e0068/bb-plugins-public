// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import type { StepId, StepOutcome, Steps } from "@bb-plugins/automation-steps/index";
import { STEP_IDS } from "@bb-plugins/automation-steps/catalog";
import { CODE_FLOW, stage } from "../core/stages-fixtures";
import { actionStage, builtinStage } from "../lib/stage-constants";
import type { FlowProgress, StageSettings, WorkStage } from "../shared/contract";
import { createAutomationRunner } from "./automation-runner";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_897e6zxubm";
const T0 = "2026-09-26T10:00:00.000Z";

const flowStage = (id: string, steps: StepId[]): WorkStage => ({ id, kind: "skill", skill: "", name: id, executors: [], automation: { source: "flow", steps } });
const action = (id: string, steps: StepId[]): WorkStage => ({ ...actionStage([]), id, name: id, automation: { source: "flow", steps } });

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

/** Шаги-фейки: пишут вызовы и отвечают по сценарию, по умолчанию успехом; ответ может быть обещанием, которое тест отпустит сам. */
const fakeSteps = (answer: (id: StepId) => StepOutcome | Promise<StepOutcome> = () => ({ ok: true, detail: null })) => {
  const calls: StepId[] = [];
  const steps = Object.fromEntries(
    STEP_IDS.map((id) => [
      id,
      async () => {
        calls.push(id);
        return answer(id);
      },
    ]),
  ) as unknown as Steps;
  return { steps, calls };
};

/** Плагин на фейковом хосте: `runner: false` — исполнителя нет, правка прогресса ничего не запускает. */
const setup = async (stages: WorkStage[], steps: Steps, options: { runner?: boolean; seeded?: Record<string, FlowProgress> } = {}) => {
  const settings: StageSettings = { stages, minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  await Promise.all(Object.entries(options.seeded ?? {}).map(([threadId, record]) => bb.storage.kv.set(`flow-progress:${threadId}`, record)));
  const store = createStore(bb.storage.kv);
  const sent: string[] = [];
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
    now: () => T0,
    onError: (error) => {
      throw error;
    },
  });
  if (options.runner !== false) advance = (threadId) => void runner.advance(threadId);
  registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread, startTimeoutMs: 100 });
  const mark = async (id: string, state: "started" | "done", threadId = THREAD) => textOf(await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: id, state }, { threadId }));
  const markDone = async (id: string, threadId = THREAD) => {
    await mark(id, "started", threadId);
    return mark(id, "done", threadId);
  };
  const track = async (id: string) => (await progress.get(THREAD))?.stages[id];
  return { mark, markDone, track, sent, progress };
};

const review = stage("review");
const testing = stage("testing");

describe("flow_stage и старт автоматизации за отмеченным этапом", () => {
  it("тред thr_897e6zxubm: implement и testing закрыты, этапы до них не тронуты — автоматизация 12 стартует, ответ это подтверждает", async () => {
    const { steps, calls } = fakeSteps();
    const { markDone, track } = await setup(CODE_FLOW, steps);
    await markDone("implement");
    const reply = await markDone("testing");
    expect(reply).toMatch(/Flow started the next stage flow-automation/);
    expect((await track("flow-automation"))?.run).toBeDefined();
    await vi.waitFor(async () => expect((await track("flow-automation"))?.finishedAt).toBeDefined());
    expect(calls).toEqual(["git.commit", "git.fast-forward", "git.create-pr", "bb.tasks-in-review"]);
  });

  it("исполнитель не записал старт — ответ говорит NOT started и что сделать", async () => {
    const { steps } = fakeSteps();
    const { markDone, track } = await setup([review, flowStage("publish", ["git.create-pr"])], steps, { runner: false });
    const reply = await markDone("review");
    expect(reply).toMatch(/publish[^.]*was NOT started/);
    expect(reply).not.toMatch(/Flow started/);
    expect((await track("publish"))?.run).toBeUndefined();
  });

  it("доработка после коммита: снова начатая реализация снимает готовность с ревью и коммита, и коммит после повторного ревью проходит заново", async () => {
    const { steps, calls } = fakeSteps();
    const { mark, markDone, track } = await setup([stage("implement"), review, flowStage("publish", ["git.create-pr"]), builtinStage("demo", [])], steps);
    await markDone("implement");
    await markDone("review");
    await vi.waitFor(async () => expect((await track("publish"))?.finishedAt).toBeDefined());

    await mark("implement", "started");
    expect([(await track("review"))?.finishedAt, (await track("publish"))?.finishedAt]).toEqual([undefined, undefined]);

    await mark("implement", "done");
    await markDone("review");
    await vi.waitFor(async () => expect((await track("publish"))?.finishedAt).toBeDefined());
    expect(calls).toEqual(["git.create-pr", "git.create-pr"]);
  });

  it("автоматизация уже прошла — повторная отметка конца без нового начала её не запускает, ответ так и говорит", async () => {
    const { steps, calls } = fakeSteps();
    const { mark, markDone, track } = await setup([review, flowStage("publish", ["git.create-pr"])], steps);
    await markDone("review");
    await vi.waitFor(async () => expect((await track("publish"))?.finishedAt).toBeDefined());
    expect(await mark("review", "done")).toMatch(/already ran/);
    expect(calls).toEqual(["git.create-pr"]);
  });

  it("раньше упала другая автоматизация — ответ называет её, следующая не запускается", async () => {
    const { steps, calls } = fakeSteps((id) => (id === "git.create-pr" ? { ok: false, error: "no token" } : { ok: true, detail: null }));
    const { mark, track } = await setup([flowStage("publish", ["git.create-pr"]), review, flowStage("land", ["git.merge"])], steps);
    await mark("review", "started");
    await vi.waitFor(async () => expect((await track("publish"))?.run?.error).toBe("no token"));
    const reply = await mark("review", "done");
    expect(reply).toMatch(/land[^.]*was NOT started/);
    expect(reply).toMatch(/automation publish failed/);
    expect(calls).toEqual(["git.create-pr"]);
    expect((await track("land"))?.run).toBeUndefined();
  });

  it("этап прямо перед автоматизацией ещё открыт — ответ говорит, что она не начата и ждёт его", async () => {
    const { steps, calls } = fakeSteps();
    const { markDone } = await setup([review, testing, flowStage("publish", ["git.create-pr"])], steps);
    const reply = await markDone("review");
    expect(reply).toMatch(/publish[^.]*has NOT started/);
    expect(reply).toMatch(/once testing is marked done/);
    expect(calls).toEqual([]);
  });

  it("тред занят другим прогоном — ответ говорит, что автоматизация в очереди, и она идёт следом", async () => {
    let release: () => void = () => undefined;
    const hold = new Promise<StepOutcome>((resolve) => (release = () => resolve({ ok: true, detail: null })));
    const { steps, calls } = fakeSteps((id) => (id === "git.merge" ? hold : { ok: true, detail: null }));
    const { mark, track } = await setup([flowStage("land", ["git.merge"]), review, flowStage("publish", ["git.create-pr"])], steps);
    await mark("review", "started");
    await vi.waitFor(() => expect(calls).toEqual(["git.merge"]));
    const reply = await mark("review", "done");
    expect(reply).toMatch(/publish[^.]*was NOT started yet/);
    expect(reply).toMatch(/land/);
    release();
    await vi.waitFor(async () => expect((await track("publish"))?.finishedAt).toBeDefined());
    expect(calls).toEqual(["git.merge", "git.create-pr"]);
  });

  it("прогон передан другому треду — ни отметки, ни запуска, и ответ это говорит", async () => {
    const { steps, calls } = fakeSteps();
    const { mark } = await setup([review, flowStage("publish", ["git.create-pr"])], steps, { seeded: { thr_src: { stages: {}, waiting: [], thread: "thr_new" } } });
    const reply = await mark("review", "done", "thr_src");
    expect(reply).toMatch(/thr_new/);
    expect(reply).toMatch(/no automation was started/i);
    expect(calls).toEqual([]);
  });
});

describe("побудка агента после доигранной автоматизации", () => {
  it("смотрит на этап за автоматизацией, а не на первый незакрытый этап flow: за ней Action — агента не будят", async () => {
    const { steps } = fakeSteps();
    const { markDone, track, sent } = await setup([stage("questions"), review, flowStage("publish", ["git.create-pr"]), action("press", ["git.merge"])], steps);
    await markDone("review");
    await vi.waitFor(async () => expect((await track("press"))?.run).toBeDefined());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toEqual([]);
  });

  it("за автоматизацией — этап агента: агента будят, хотя этапы в начале flow не тронуты", async () => {
    const { steps } = fakeSteps();
    const { markDone, sent } = await setup(CODE_FLOW, steps);
    await markDone("implement");
    await markDone("testing");
    await vi.waitFor(() => expect(sent).toHaveLength(1));
  });
});
