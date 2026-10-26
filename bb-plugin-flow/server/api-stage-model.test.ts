// @vitest-environment node
// Встроенные этапы закрывает ответ владельца, а не отметка агента: модель следующего этапа ставится в ответе на бриф.
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import { addFlow, newFlow } from "../core/flows";
import { stage } from "../core/stages-fixtures";
import type { DecisionAnswer, DecisionBrief, FlowProgress, StageSettings } from "../shared/contract";
import plugin from "../server";
import { registerApi } from "./api";
import { FLOW_STAGE_TOOL, createProgress } from "./progress";
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

  const setup = async (stageModel: (threadId: string, progress: FlowProgress) => Promise<string | null>) => {
    const log: string[] = [];
    const owners: boolean[] = [];
    const seen: FlowProgress[] = [];
    const { bb, harness } = createFakePluginHost({
      pluginId: "flow",
      sdk: {
        threads: {
          compact: async () => (log.push("compact"), { ok: true }),
          update: async (args: { model?: string | null | undefined }) => (log.push(`update:${args.model}`), {}),
          send: async () => (log.push("send"), { delivery: "queued" }),
          get: async () => ({ providerId: "claude-code", projectId: "proj_1", environmentId: "env_1" }),
        },
      },
    });
    const store = createStore(bb.storage.kv);
    const progress = createProgress(bb.storage.kv);
    await store.putBrief(brief);
    await progress.recordBrief(brief, T0);
    registerApi(bb, store, { now: () => T0, stages: () => settings.stages, progress, ownerModel: (_threadId, chosen) => void owners.push(chosen), stageModel: async (threadId, after) => (seen.push(after), stageModel(threadId, after)) });
    return { call: (input: unknown) => harness.callRpc("answerBrief", input), log, seen, owners };
  };

  it("перед репликой тред получает модель, а прогресс в помощник приходит уже с этим ответом", async () => {
    const { call, log, seen } = await setup(async () => "claude-sonnet-4-5");
    await call({ id: "dec_1", answer: answer(), messageId: "m" });
    expect(log).toEqual(["update:claude-sonnet-4-5", "send"]);
    expect(seen[0]?.stages.select?.finishedAt).toBeDefined();
  });

  it("со сжатием: сначала сжатие, потом модель, потом реплика", async () => {
    const { call, log } = await setup(async () => "claude-sonnet-4-5");
    await call({ id: "dec_1", answer: answer({ compact: true }), messageId: "m" });
    expect(log).toEqual(["compact", "update:claude-sonnet-4-5", "send"]);
  });

  it("модель, выбранная владельцем, главнее: помощник не зовётся", async () => {
    const { call, log, seen } = await setup(async () => "claude-sonnet-4-5");
    await call({ id: "dec_1", answer: answer({ execution: { providerId: "claude-code", model: "claude-opus-4-1", reasoningLevel: "high" } }), messageId: "m" });
    expect(log).toEqual(["update:claude-opus-4-1", "send"]);
    expect(seen).toEqual([]);
  });

  it("выбор модели владельцем помечается за тредом, ответ без выбора помету снимает", async () => {
    const { call, owners } = await setup(async () => null);
    await call({ id: "dec_1", answer: answer({ execution: { providerId: "claude-code", model: "claude-opus-4-1", reasoningLevel: "high" } }), messageId: "m" });
    expect(owners).toEqual([true]);
    const without = await setup(async () => null);
    await without.call({ id: "dec_1", answer: answer(), messageId: "m" });
    expect(without.owners).toEqual([false]);
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

describe("answerBrief во входе сервера: следующий этап и модель из bb", () => {
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
          update: async (args: { model?: string | null | undefined }) => (log.push(`update:${args.model}`), {}),
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

  const run = [{ id: "implement", run: true, executor: "self" }, { id: "review", run: true, executor: "self" }];

  it("ответ на Выбор этапов переводит тред с Opus на Sonnet перед репликой: дальше реализация", async () => {
    const { log, reply } = await boot("claude-opus-4-1", { select: { startedAt: T0 } });
    await reply(run);
    expect(log).toEqual(["update:claude-sonnet-4-5", "send"]);
  });

  it("тред уже на Sonnet — модель не трогается", async () => {
    const { log, reply } = await boot("claude-sonnet-4-5", { select: { startedAt: T0 } });
    await reply(run);
    expect(log).toEqual(["send"]);
  });

  it("реализацию владелец вычеркнул: следующий этап — ревью на Opus, тред остаётся на Opus", async () => {
    const { log, reply } = await boot("claude-opus-4-1", { select: { startedAt: T0 } });
    await reply([{ id: "implement", run: false, executor: "self" }, { id: "review", run: true, executor: "self" }]);
    expect(log).toEqual(["send"]);
  });

  it("модель, выбранная владельцем в брифе, не перебивается ни «начат», ни «готово» на этапе другой модели", async () => {
    const { log, reply, harness } = await boot("claude-opus-4-1", { select: { startedAt: T0 } });
    await reply(run, { providerId: "claude-code", model: "claude-opus-4-1", reasoningLevel: "high" });
    log.length = 0;
    const mark = async (stageId: string, state: "started" | "done") => {
      const answer = (await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: stageId, state }, { threadId: THREAD })) as { content: Array<{ text: string }> } | string;
      return typeof answer === "string" ? answer : answer.content.map((part) => part.text).join("");
    };
    expect(await mark("implement", "started")).toBe("Stage implement marked started.");
    expect(await mark("implement", "done")).toBe("Stage implement marked done.");
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(log).toEqual([]);
  });
});
