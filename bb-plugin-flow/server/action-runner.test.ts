// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import { STEP_IDS } from "../packages/automation-steps/catalog";
import type { StepId, StepOutcome, Steps } from "../packages/automation-steps/index";
import { stage } from "../core/stages-fixtures";
import type { StageSettings, WorkStage } from "../shared/contract";
import { createAutomationRunner, registerAutomationRunner } from "./automation-runner";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_action";
const T0 = "2026-09-17T10:00:00.000Z";

const actionStageOf = (id: string, steps: StepId[]): WorkStage => ({ id, kind: "action", skill: "", name: id, executors: [], automation: { source: "flow", steps } });
const automationStageOf = (id: string, steps: StepId[]): WorkStage => ({ id, kind: "skill", skill: "", name: id, executors: [], automation: { source: "flow", steps } });

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

/** Шаги-фейки: считают вызовы и отвечают по сценарию; ответ по умолчанию — успех. */
const fakeSteps = (answer: (id: StepId, call: number) => Promise<StepOutcome> = async () => ({ ok: true, detail: null })) => {
  const calls: StepId[] = [];
  const steps = Object.fromEntries(
    STEP_IDS.map((id) => [
      id,
      async () => {
        calls.push(id);
        return answer(id, calls.length);
      },
    ]),
  ) as unknown as Steps;
  return { steps, calls };
};

const setup = (stages: WorkStage[], steps: Steps) => {
  const settings: StageSettings = { stages, minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  let advance: (threadId: string) => void = () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
  const thread = async () => ({ active: false, providerId: "claude-code", environmentId: null });
  const woken: string[] = [];
  const runner = createAutomationRunner({
    progress,
    store,
    stages: () => settings,
    steps,
    external: async () => ({ ok: true, detail: null }),
    thread,
    providers: async () => [],
    kv: bb.storage.kv,
    plugins: { list: async () => ({ plugins: [] }), applyUpdate: async () => undefined, install: async () => undefined, remove: async () => undefined },
    wake: async (threadId) => void woken.push(threadId),
    now: () => T0,
    onError: (error) => {
      throw error;
    },
  });
  advance = (threadId) => void runner.advance(threadId);
  registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread });
  registerAutomationRunner(bb, runner);
  const view = () =>
    harness.callRpc("getFlowProgress", { threadId: THREAD }) as Promise<{ stages: Array<{ id: string; state: string; automation?: { steps: Array<{ state: string; error: string | null }> } }> } | null>;
  const stepsOf = async (id: string) => (await view())?.stages.find((s) => s.id === id)?.automation?.steps.map((s) => s.state);
  const stateOf = async (id: string) => (await view())?.stages.find((s) => s.id === id)?.state;
  const press = (stage: string) => harness.callRpc("runActionStep", { threadId: THREAD, stage }) as Promise<{ started: boolean }>;
  const finishReview = async () => {
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "started" }, { threadId: THREAD });
    return textOf(await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD }));
  };
  return { harness, store, view, stepsOf, stateOf, press, finishReview, woken };
};

const review = stage("review");

describe("этап Action: шаг за нажатие владельца", () => {
  it("прогон останавливается на этапе Action и ждёт владельца", async () => {
    const { steps, calls } = fakeSteps();
    const { finishReview, stepsOf, store } = setup([review, actionStageOf("publish", ["git.create-pr", "bb.tasks-in-review"])], steps);
    const reply = await finishReview();
    await vi.waitFor(async () => expect(await stepsOf("publish")).toEqual(["wait", "todo"]));
    expect(calls).toEqual([]);
    expect(reply).toMatch(/action/i);
    expect(await store.listAwaiting()).toEqual([{ threadId: THREAD, briefId: "action:publish", kind: "action" }]);
  });

  it("нажатие выполняет ровно один шаг и показывает кнопку следующего", async () => {
    const { steps, calls } = fakeSteps();
    const { finishReview, press, stepsOf } = setup([review, actionStageOf("publish", ["git.create-pr", "bb.tasks-in-review"])], steps);
    await finishReview();
    await vi.waitFor(async () => expect(await stepsOf("publish")).toEqual(["wait", "todo"]));
    expect(await press("publish")).toEqual({ started: true });
    await vi.waitFor(async () => expect(await stepsOf("publish")).toEqual(["done", "wait"]));
    expect(calls).toEqual(["git.create-pr"]);
  });

  it("нажатие во время идущего шага ничего не запускает", async () => {
    let release = () => undefined as void;
    const held = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    const { steps, calls } = fakeSteps(async () => {
      await held;
      return { ok: true, detail: null };
    });
    const { finishReview, press, stepsOf } = setup([review, actionStageOf("publish", ["git.create-pr", "bb.tasks-in-review"])], steps);
    await finishReview();
    await vi.waitFor(async () => expect(await stepsOf("publish")).toEqual(["wait", "todo"]));
    void press("publish");
    await vi.waitFor(async () => expect(await stepsOf("publish")).toEqual(["now", "todo"]));
    expect(await press("publish")).toEqual({ started: false });
    release();
    await vi.waitFor(async () => expect(calls).toEqual(["git.create-pr"]));
  });

  it("упавший шаг показывает ошибку и оставляет тред в ожидании владельца", async () => {
    const { steps } = fakeSteps(async () => ({ ok: false, error: "GitHub ответил 405" }));
    const { finishReview, press, stepsOf, store } = setup([review, actionStageOf("publish", ["git.create-pr"])], steps);
    await finishReview();
    await vi.waitFor(async () => expect(await stepsOf("publish")).toEqual(["wait"]));
    await press("publish");
    await vi.waitFor(async () => expect(await stepsOf("publish")).toEqual(["fail"]));
    expect(await store.listAwaiting()).toEqual([{ threadId: THREAD, briefId: "action:publish", kind: "action" }]);
  });

  it("повторное нажатие после ошибки исполняет тот же шаг", async () => {
    const { steps, calls } = fakeSteps(async (_id, call) => (call === 1 ? { ok: false, error: "GitHub ответил 405" } : { ok: true, detail: null }));
    const { finishReview, press, stepsOf } = setup([review, actionStageOf("publish", ["git.create-pr"])], steps);
    await finishReview();
    await vi.waitFor(async () => expect(await stepsOf("publish")).toEqual(["wait"]));
    await press("publish");
    await vi.waitFor(async () => expect(await stepsOf("publish")).toEqual(["fail"]));
    await press("publish");
    await vi.waitFor(async () => expect(calls).toEqual(["git.create-pr", "git.create-pr"]));
  });

  it("последний шаг закрывает этап, запускает автоматизацию за ним и будит агента перед этапом навыка", async () => {
    const { steps, calls } = fakeSteps();
    const next = stage("implement");
    const { finishReview, press, stateOf, woken } = setup([review, actionStageOf("publish", ["git.create-pr"]), automationStageOf("land", ["git.merge"]), next], steps);
    await finishReview();
    await vi.waitFor(async () => expect(await stateOf("publish")).toBe("now"));
    await press("publish");
    await vi.waitFor(async () => expect(await stateOf("land")).toBe("done"));
    expect(calls).toEqual(["git.create-pr", "git.merge"]);
    expect(woken).toEqual([THREAD]);
  });

  it("этап Action последним в flow агента не будит: продолжать нечего", async () => {
    const { steps } = fakeSteps();
    const { finishReview, press, stateOf, woken } = setup([review, actionStageOf("publish", ["git.create-pr"])], steps);
    await finishReview();
    await vi.waitFor(async () => expect(await stateOf("publish")).toBe("now"));
    await press("publish");
    await vi.waitFor(async () => expect(await stateOf("publish")).toBe("done"));
    expect(woken).toEqual([]);
  });

  it("пустой этап Action закрывается сам: нажимать нечего", async () => {
    const { steps } = fakeSteps();
    const { finishReview, stateOf, store } = setup([review, actionStageOf("publish", []), automationStageOf("land", ["git.merge"])], steps);
    await finishReview();
    await vi.waitFor(async () => expect([await stateOf("publish"), await stateOf("land")]).toEqual(["done", "done"]));
    expect(await store.listAwaiting()).toEqual([]);
  });

  it("агент не отмечает этап Action сам", async () => {
    const { steps } = fakeSteps();
    const { harness } = setup([review, actionStageOf("publish", ["git.create-pr"])], steps);
    const reply = textOf(await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "publish", state: "done" }, { threadId: THREAD }));
    expect(reply).toMatch(/owner/i);
  });
});
