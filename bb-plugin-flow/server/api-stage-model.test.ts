// @vitest-environment node
// Встроенные этапы закрывает ответ владельца, а не отметка агента: модель следующего этапа ставится в ответе на бриф.
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import { addFlow, newFlow } from "../core/flows";
import { stage } from "../core/stages-fixtures";
import type { StageModel } from "../core/context";
import type { DecisionAnswer, DecisionBrief, Execution, FlowProgress, StageSettings } from "../shared/contract";
import plugin from "../server";
import { registerApi } from "./api";
import { createProgress } from "./progress";
import { createStore } from "./store";

const T0 = "2026-10-26T10:00:00.000Z";

describe("answerBrief: модель следующего этапа", () => {
  const settings: StageSettings = { stages: [builtinStage("select", []), stage("implement", { skill: "code-standards-fp", name: "Реализация" })], minButtonWidth: 170 };
  const brief: DecisionBrief = {
    id: "dec_1",
    threadId: "thr_src",
    title: "Выбор этапов",
    createdAt: T0,
    kind: "brief",
    questions: [],
    setup: { stages: [{ id: "select", state: "todo", recommended: false, executor: "self" }, { id: "implement", state: "todo", recommended: true, executor: "self", share: { percent: 100, risk: 1 } }] },
    stages: { list: settings.stages, minButtonWidth: 170 },
  };
  const answer = (extra: Partial<DecisionAnswer> = {}): DecisionAnswer => ({ briefId: "dec_1", answers: [], stages: [{ id: "implement", run: true, executor: "self" }], place: "here", ...extra });

  const setup = async (stageModel: (threadId: string, progress: FlowProgress) => Promise<StageModel | null>) => {
    const log: string[] = [];
    const seen: FlowProgress[] = [];
    const { bb, harness } = createFakePluginHost({
      pluginId: "flow",
      sdk: {
        threads: {
          compact: async () => (log.push("compact"), { ok: true }),
          update: async (args: { model?: string | null | undefined; reasoningLevel?: string | null | undefined }) => (log.push(`update:${args.model}/${args.reasoningLevel}`), {}),
          send: async () => (log.push("send"), { delivery: "queued" }),
          get: async () => ({ providerId: "claude-code", projectId: "proj_1", environmentId: "env_1" }),
        },
      },
    });
    const store = createStore(bb.storage.kv);
    const progress = createProgress(bb.storage.kv);
    await store.putBrief(brief);
    await progress.recordBrief(brief, T0);
    registerApi(bb, store, { now: () => T0, stages: () => settings.stages, progress, stageModel: async (threadId, after) => (seen.push(after), stageModel(threadId, after)) });
    return { call: (input: unknown) => harness.callRpc("answerBrief", input), log, seen };
  };

  const SONNET: StageModel = { model: "claude-sonnet-4-5", reasoningLevel: "high" };

  it("перед репликой тред получает утверждённую модель с effort, а прогресс в помощник приходит уже с этим ответом", async () => {
    const { call, log, seen } = await setup(async () => SONNET);
    await call({ id: "dec_1", answer: answer(), messageId: "m" });
    expect(log).toEqual(["update:claude-sonnet-4-5/high", "send"]);
    expect(seen[0]?.stages.select?.finishedAt).toBeDefined();
  });

  it("со сжатием: сначала сжатие, потом модель, потом реплика", async () => {
    const { call, log } = await setup(async () => SONNET);
    await call({ id: "dec_1", answer: answer({ compact: true }), messageId: "m" });
    expect(log).toEqual(["compact", "update:claude-sonnet-4-5/high", "send"]);
  });

  it("модель, выбранная владельцем, главнее: помощник не зовётся", async () => {
    const { call, log, seen } = await setup(async () => SONNET);
    await call({ id: "dec_1", answer: answer({ execution: { providerId: "claude-code", model: "claude-opus-4-1", reasoningLevel: "high" } }), messageId: "m" });
    expect(log).toEqual(["update:claude-opus-4-1/high", "send"]);
    expect(seen).toEqual([]);
  });

  it("менять нечего или помощник упал — ответ принимается без смены модели", async () => {
    const none = await setup(async () => null);
    await none.call({ id: "dec_1", answer: answer(), messageId: "m" });
    expect(none.log).toEqual(["send"]);
    const broken = await setup(async () => {
      throw new Error("нет каталога");
    });
    await broken.call({ id: "dec_1", answer: answer(), messageId: "m" });
    expect(broken.log).toEqual(["send"]);
  });
});

describe("ответ ставит утверждённую модель следующего этапа", () => {
  const THREAD = "thr_stage_model";
  const flowStages = [builtinStage("select", []), stage("implement", { skill: "code-standards-fp", name: "Implementation" }), stage("review", { name: "Review" })];
  const stored: DecisionBrief = {
    id: "dec_wired",
    threadId: THREAD,
    title: "Выбор этапов",
    createdAt: T0,
    kind: "brief",
    questions: [],
    setup: { stages: flowStages.map((s) => ({ id: s.id, state: "todo" as const, recommended: s.id !== "select", executor: "self", ...(s.id === "select" ? {} : { share: { percent: 100, risk: 1 } }) })) },
    stages: { list: flowStages, minButtonWidth: 170 },
  };

  const boot = async (model: string, runStages: Record<string, unknown>) => {
    const log: string[] = [];
    const { bb, harness } = createFakePluginHost({
      pluginId: "flow",
      sdk: {
        threads: {
          get: async () => ({ id: THREAD, providerId: "claude-code", status: "idle", environmentId: null, title: null, projectId: "proj_a" }),
          defaultExecutionOptions: async () => ({ model, reasoningLevel: "medium" }),
          events: { list: async () => [] },
          update: async (args: { model?: string | null | undefined; reasoningLevel?: string | null | undefined }) => (log.push(`update:${args.model}/${args.reasoningLevel}`), {}),
          send: async () => (log.push("send"), { delivery: "queued" }),
        },
        providers: {
          models: async () => ({
            providers: [{ id: "claude-code", available: true }],
            models: [
              { model: "claude-opus-4-1", isDefault: true, defaultReasoningEffort: "medium" },
              { model: "claude-sonnet-4-5", isDefault: false, defaultReasoningEffort: "medium" },
            ],
          }),
          list: async () => [],
        },
      },
    });
    await plugin(bb);
    const flows = await harness.callRpc("getFlowSettings", {});
    await harness.callRpc("saveFlowSettings", addFlow(flows as never, { ...newFlow("practice", "Practice"), stages: flowStages }));
    await harness.callRpc("setFlowChoice", { projectId: "proj_a", flowId: "practice" });
    await harness.emitThreadEvent("thread.created", { thread: makeThreadResponse({ id: THREAD, projectId: "proj_a", parentThreadId: null }) });
    await createStore(bb.storage.kv).putBrief(stored);
    await bb.storage.kv.set(`flow-thread:${THREAD}`, { run: "run_wired" });
    await bb.storage.kv.set("flow-progress:run_wired", { stages: runStages, waiting: ["select"], lastBriefId: "dec_wired", thread: THREAD });
    const reply = (stages: DecisionAnswer["stages"], execution?: DecisionAnswer["execution"]) =>
      harness.callRpc("answerBrief", { id: "dec_wired", answer: { briefId: "dec_wired", answers: [], stages, place: "here", ...(execution === undefined ? {} : { execution }) }, messageId: "m" });
    return { log, reply, harness };
  };

  const SONNET: Execution = { providerId: "claude-code", model: "claude-sonnet-4-5", reasoningLevel: "high" };
  const OPUS: Execution = { providerId: "claude-code", model: "claude-opus-4-1", reasoningLevel: "medium" };
  const run = [
    { id: "implement", run: true, executor: "self", model: SONNET },
    { id: "review", run: true, executor: "self", model: OPUS },
  ];

  it("ответ на Выбор этапов ставит треду утверждённую модель и effort реализации перед репликой", async () => {
    const { log, reply } = await boot("claude-opus-4-1", { select: { startedAt: T0 } });
    await reply(run);
    expect(log).toEqual(["update:claude-sonnet-4-5/high", "send"]);
  });

  it("утверждённое уже стоит — модель не трогается", async () => {
    const { log, reply } = await boot("claude-sonnet-4-5", { select: { startedAt: T0 } });
    await reply([{ ...run[0]!, model: { ...SONNET, reasoningLevel: "medium" } }, run[1]!]);
    expect(log).toEqual(["send"]);
  });

  it("ответ без моделей этапов модель треда не меняет — даже перед реализацией", async () => {
    const { log, reply } = await boot("claude-opus-4-1", { select: { startedAt: T0 } });
    await reply([{ id: "implement", run: true, executor: "self" }, { id: "review", run: true, executor: "self" }]);
    expect(log).toEqual(["send"]);
  });

  it("реализацию владелец вычеркнул: следующий этап — ревью на утверждённой Opus, тред остаётся на Opus", async () => {
    const { log, reply } = await boot("claude-opus-4-1", { select: { startedAt: T0 } });
    await reply([{ ...run[0]!, run: false }, run[1]!]);
    expect(log).toEqual(["send"]);
  });
});
