// @vitest-environment node
// Агент зовёт retry_automation на упавшем шаге: Flow повторяет шаг тем же раннером, что и кнопка владельца, а вызов
// ждёт итог и отвечает им в этом же ходе.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import type { StepOutcome, Steps } from "@bb-plugins/automation-steps/index";
import { STEP_IDS } from "@bb-plugins/automation-steps/catalog";
import { onRunStart, onStepFailed, stepsOf } from "../core/automation-run";
import { stage } from "../core/stages-fixtures";
import { actionStage, RETRY_AUTOMATION_TOOL } from "../lib/stage-constants";
import type { StageSettings, WorkStage } from "../shared/contract";
import { createAgentRelay } from "./agent-relay";
import { createAutomationRunner } from "./automation-runner";
import { createProgress, FLOW_STAGE_TOOL, registerProgress } from "./progress";
import { registerRetryTool } from "./retry-tool";
import { createStore } from "./store";

const THREAD = "thr_retry_tool";
const T0 = "2026-10-13T10:00:00.000Z";

const land: WorkStage = { id: "land", kind: "skill", skill: "", name: "Commit, PR", executors: [], automation: { source: "flow", steps: ["git.create-pr"] } };
const demo: WorkStage = stage("demo", { kind: "demo", skill: "", name: "Демонстрация" });

/** `git.create-pr` падает столько раз, сколько велено, потом проходит; вызовы считаются. */
const flaky = (failures: number, afterwards?: () => Promise<StepOutcome>) => {
  const state = { left: failures, calls: 0 };
  const steps = Object.fromEntries(
    STEP_IDS.map((id) => [
      id,
      async (): Promise<StepOutcome> => {
        if (id !== "git.create-pr") return { ok: true, detail: null };
        state.calls += 1;
        if (state.left > 0) {
          state.left -= 1;
          return { ok: false, error: "gh: rate limited" };
        }
        return afterwards?.() ?? { ok: true, detail: null };
      },
    ]),
  ) as unknown as Steps;
  return { steps, state };
};

const setup = (steps: Steps, options: { waitMs?: number; policy?: { seconds: number; attempts: number } } = {}) => {
  const settings: StageSettings = { stages: [stage("review"), land, demo], minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  let advance: (threadId: string) => void = () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
  const thread = async () => ({ active: true, providerId: "claude-code", environmentId: null });
  const sent: string[] = [];
  let relay = createAgentRelay({ busy: () => false, alive: async () => false, send: async () => undefined, onError: () => undefined });
  const runner = createAutomationRunner({
    progress,
    store: createStore(bb.storage.kv),
    stages: () => settings,
    steps,
    external: async () => ({ ok: true as const, detail: null }),
    thread,
    providers: async () => [],
    kv: bb.storage.kv,
    plugins: { list: async () => ({ plugins: [] }), applyUpdate: async () => undefined, install: async () => undefined, remove: async () => undefined },
    now: () => T0,
    retry: () => options.policy ?? { seconds: 0, attempts: 0 },
    // Таймер автоповтора в тесте не идёт: срок только записывается в прогон.
    schedule: () => () => undefined,
    wake: (threadId, text) => relay.deliver(threadId, text),
    onError: () => undefined,
  });
  relay = createAgentRelay({ busy: (threadId) => runner.busy(threadId), alive: async () => true, send: async (_threadId, text) => void sent.push(text), onError: () => undefined, pollMs: 5 });
  advance = (threadId) => void runner.advance(threadId);
  registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread, startTimeoutMs: 200, relay, relayWaitMs: 2000 });
  registerRetryTool(bb, { stages: () => settings, progress, runner, relay, waitMs: options.waitMs ?? 2000 });
  const failFirst = async () => {
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "started" }, { threadId: THREAD });
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
  };
  const retry = async (stageId: string, threadId = THREAD) => {
    const answer = (await harness.callAgentTool(RETRY_AUTOMATION_TOOL, { stage: stageId }, { threadId })) as { isError?: boolean; content: Array<{ text: string }> } | string;
    return typeof answer === "string" ? { isError: false, text: answer } : { isError: answer.isError === true, text: answer.content.map((part) => part.text).join("") };
  };
  return { failFirst, retry, progress, sent, harness };
};

describe("retry_automation — агент повторяет упавший шаг сам", () => {
  it("шаг прошёл со второй попытки — ответ говорит, что повтор прошёл, а в тред ничего не уходит", async () => {
    const { steps, state } = flaky(1);
    const { failFirst, retry, sent, progress } = setup(steps);
    await failFirst();
    expect(state.calls).toBe(1);
    const answer = await retry("land");
    expect(answer.isError).toBe(false);
    expect(answer.text).toContain('Flow retried stage land "Commit, PR"');
    expect(state.calls).toBe(2);
    expect((await progress.get(THREAD))?.stages.land?.finishedAt).toBeDefined();
    expect(sent).toEqual([]);
  });

  it("реплика Flow о следующем этапе приходит в этом же ответе", async () => {
    const { steps } = flaky(1);
    const { failFirst, retry } = setup(steps);
    await failFirst();
    expect((await retry("land")).text).toContain('Next stage: demo "Демонстрация".');
  });

  it("повтор упал снова — ответ называет шаг и ошибку, шаг остаётся ждать, и агент может повторить ещё раз", async () => {
    const { steps, state } = flaky(2);
    const { failFirst, retry, progress } = setup(steps);
    await failFirst();
    const second = await retry("land");
    expect(second.text).toContain("failed again at step git.create-pr (gh: rate limited)");
    expect((await progress.get(THREAD))?.stages.land?.finishedAt).toBeUndefined();
    const third = await retry("land");
    expect(third.text).toContain("Flow retried stage land");
    expect(state.calls).toBe(3);
  });

  it("автоповтор впереди (настройки по умолчанию) — ответ говорит, что Flow повторит сам, и не просит повторять агента", async () => {
    const { steps } = flaky(2);
    const { failFirst, retry } = setup(steps, { policy: { seconds: 30, attempts: 10 } });
    await failFirst();
    const answer = await retry("land");
    expect(answer.text).toContain("failed again at step git.create-pr (gh: rate limited)");
    expect(answer.text).toContain("Flow retries the step by itself at 2026-10-13T10:00:30.000Z");
    expect(answer.text).not.toContain("call retry_automation");
  });

  it("шаг идёт дольше срока ожидания — ответ велит закончить ход, а итог потом приходит в тред", async () => {
    let finish: () => void = () => undefined;
    const slow = () => new Promise<StepOutcome>((resolve) => (finish = () => resolve({ ok: true, detail: null })));
    const { steps } = flaky(1, slow);
    const { failFirst, retry, sent } = setup(steps, { waitMs: 50 });
    await failFirst();
    expect((await retry("land")).text).toContain("still runs");
    finish();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toContain('Next stage: demo "Демонстрация".');
  });
});

describe("retry_automation — отказы", () => {
  it("упавшего шага нет — отказ с причиной, ничего не запускается", async () => {
    const { steps, state } = flaky(0);
    const { retry } = setup(steps);
    const answer = await retry("land");
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("has no failed step");
    expect(state.calls).toBe(0);
  });

  it("этап агента — отказ", async () => {
    const { steps } = flaky(0);
    const { retry } = setup(steps);
    const answer = await retry("review");
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("is not an automation");
  });

  it("этапа нет во flow — отказ называет этапы flow", async () => {
    const { steps } = flaky(0);
    const { retry } = setup(steps);
    const answer = await retry("nope");
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("review, land, demo");
  });

  it("работа передана другому треду — отказ называет носителя, шаг не повторяется", async () => {
    const { steps, state } = flaky(1);
    const { failFirst, retry, progress } = setup(steps);
    await failFirst();
    await progress.handOver(THREAD, "thr_carrier", [{ id: "land", run: true, executor: "self" }]);
    const answer = await retry("land");
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("thr_carrier");
    expect(state.calls).toBe(1);
  });
});

describe("retry_automation — граница с раннером", () => {
  const press: WorkStage = { ...actionStage([]), id: "press", name: "Press", automation: { source: "flow", steps: ["git.create-pr"] } };

  /** Тред с упавшим шагом в записи прогона и раннером-заглушкой: что раннер ответит на повтор — решает тест. */
  const seeded = async (retry: (relay: ReturnType<typeof createAgentRelay>) => Promise<{ started: boolean; busy?: true }>) => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    const progress = createProgress(bb.storage.kv);
    for (const stage of [land, press]) {
      await progress.update(THREAD, (p) => onStepFailed(onRunStart(p, stage.id, stepsOf(stage), T0), stage.id, "gh: rate limited", T0));
    }
    const sent: string[] = [];
    const relay = createAgentRelay({ busy: () => false, alive: async () => true, send: async (_threadId, text) => void sent.push(text), onError: () => undefined, pollMs: 5 });
    const settings: StageSettings = { stages: [land, press], minButtonWidth: 170 };
    registerRetryTool(bb, { stages: () => settings, progress, runner: { retry: () => retry(relay) }, relay, waitMs: 50 });
    const call = async (stageId: string) => {
      const answer = (await harness.callAgentTool(RETRY_AUTOMATION_TOOL, { stage: stageId }, { threadId: THREAD })) as { isError?: boolean; content: Array<{ text: string }> };
      return { isError: answer.isError === true, text: answer.content.map((part) => part.text).join("") };
    };
    return { call, sent };
  };

  it("Flow занят другой работой треда — отказ «позже», а реплика, которую успело перехватить ожидание, уходит в тред", async () => {
    const { call, sent } = await seeded(async (relay) => {
      await relay.deliver(THREAD, "Flow: a late message");
      return { started: false, busy: true };
    });
    const answer = await call("land");
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("busy");
    await vi.waitFor(() => expect(sent).toEqual(["Flow: a late message"]));
  });

  it("этап Action — отказ, раннер не зовётся", async () => {
    const retry = vi.fn(async () => ({ started: true }));
    const { call } = await seeded(retry);
    const answer = await call("press");
    expect(answer.isError).toBe(true);
    expect(answer.text).toContain("is an action");
    expect(retry).not.toHaveBeenCalled();
  });
});
