// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import type { StepId, StepOutcome, Steps } from "@bb-plugins/automation-steps/index";
import { STEP_IDS } from "@bb-plugins/automation-steps/catalog";
import { onMark } from "../core/progress";
import { stage } from "../core/stages-fixtures";
import type { StageSettings, WorkStage } from "../shared/contract";
import { createAgentRelay } from "./agent-relay";
import { createAutomationRunner, registerAutomationRunner } from "./automation-runner";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

// BBPL-981: автоматизация доиграна, пока ход агента идёт, и реплика «Next stage» встаёт в очередь его хода. За это время
// агент сам закрывает следующий этап — к концу хода реплика не нужна: иначе он отметил бы закрытый этап начатым, и всё
// после него сбросилось бы заново. Реплика идёт через настоящий посредник; ход агента управляется тестом.

const THREAD = "thr_late_wake";
const T0 = "2026-10-27T10:00:00.000Z";

const auto: WorkStage = { id: "auto", kind: "skill", skill: "", name: "auto", executors: [], automation: { source: "flow", steps: ["git.merge"] } };
const stages = [stage("review"), auto, stage("demo"), stage("wrap")];

const setup = () => {
  const settings: StageSettings = { stages, minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  let advance: (threadId: string) => void = () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
  const turn = { alive: true };
  const sent: string[] = [];
  /** Перепроверки, которые посредник уже дождался: негативный итог читается после них, а не после паузы. */
  const checked: boolean[] = [];
  const steps = Object.fromEntries(STEP_IDS.map((id) => [id, async (): Promise<StepOutcome> => ({ ok: true, detail: null })])) as unknown as Steps;
  const thread = async () => ({ active: turn.alive, providerId: "claude-code", environmentId: null });
  const plugins = { list: async () => ({ plugins: [] }), applyUpdate: async () => undefined, install: async () => undefined, remove: async () => undefined };
  const relay = createAgentRelay({
    busy: (threadId) => runner.busy(threadId),
    alive: async () => turn.alive,
    send: async (_threadId, text) => void sent.push(text),
    onError: (error) => { throw error; },
    pollMs: 5,
  });
  const runner = createAutomationRunner({
    progress, store, stages: () => settings, steps, external: async () => ({ ok: true as const, detail: null }), thread, providers: async () => [], kv: bb.storage.kv, plugins,
    now: () => T0,
    wake: (threadId, text, due) => relay.deliver(threadId, text, due && (async () => { const answer = await due(); checked.push(answer); return answer; })), onError: (error: unknown) => { throw error; },
  });
  advance = (threadId) => void runner.advance(threadId);
  registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread });
  registerAutomationRunner(bb, runner);
  /** Автоматизация доиграна и тред свободен: реплика либо отложена, либо уже ушла. */
  const played = async () => {
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "review", state: "done" }, { threadId: THREAD });
    await vi.waitFor(async () => expect((await progress.get(THREAD))?.stages.auto?.finishedAt).toBeDefined());
    await vi.waitFor(() => expect(runner.busy(THREAD)).toBe(false));
  };
  /** Ход кончился, и посредник перепроверил отложенную реплику. */
  const endTurn = async () => {
    turn.alive = false;
    await vi.waitFor(() => expect(checked).toHaveLength(1));
  };
  return { progress, store, sent, turn, played, endTurn };
};

describe("реплика после автоматизации, доигранной во время хода агента", () => {
  it("агент закрыл следующий этап за ход — реплика не уходит, закрытое остаётся закрытым", async () => {
    const { progress, sent, played, endTurn } = setup();
    await played();
    expect(sent).toEqual([]);
    await progress.update(THREAD, (p) => onMark(onMark(p, "demo", "started", T0), "demo", "done", T0));
    await endTurn();
    expect(sent).toEqual([]);
    const record = await progress.get(THREAD);
    expect(record?.stages.demo?.finishedAt).toBeDefined();
    expect(record?.stages.auto?.finishedAt).toBeDefined();
  });

  it("агент ничего не закрыл — реплика уходит один раз после конца хода, не раньше", async () => {
    const { sent, played, endTurn } = setup();
    await played();
    expect(sent).toEqual([]);
    await endTurn();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toContain('"demo"');
  });

  it("агент только начал следующий этап — он всё ещё следующий открытый, реплика уходит", async () => {
    const { progress, sent, played, endTurn } = setup();
    await played();
    await progress.update(THREAD, (p) => onMark(p, "demo", "started", T0));
    await endTurn();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
  });

  it("к концу хода тред ждёт ответа владельца — реплика не уходит", async () => {
    const { store, sent, played, endTurn } = setup();
    await played();
    await store.putAwaiting(THREAD, { briefId: "A", kind: "approve" });
    await endTurn();
    expect(sent).toEqual([]);
  });

  it("хода агента уже нет — реплика уходит сразу, как раньше", async () => {
    const { sent, turn, played } = setup();
    turn.alive = false;
    await played();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
  });
});
