// @vitest-environment node
// Граница этапов в ответе flow_stage: контекст выше жёлтого порога или другая модель следующего этапа — агент заканчивает ход,
// а Flow на простое сжимает тред, ставит модель и присылает «продолжай». Ниже порога и на той же модели ответ прежний.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { StepOutcome, Steps } from "@bb-plugins/automation-steps/index";
import { STEP_IDS } from "@bb-plugins/automation-steps/catalog";
import { stage } from "../core/stages-fixtures";
import type { ContextFillView, StageSettings, WorkStage } from "../shared/contract";
import { createAgentRelay } from "./agent-relay";
import { createAutomationRunner } from "./automation-runner";
import { createBoundary } from "./boundary";
import { FLOW_STAGE_TOOL, createProgress, registerProgress, stageStateOf } from "./progress";
import { createStageModels } from "./stage-models";
import { createStore } from "./store";

const THREAD = "thr_boundary";
const T0 = "2026-10-26T10:00:00.000Z";

const review = stage("review", { name: "Review" });
const implement = stage("implement", { skill: "code-standards-fp", name: "Implementation" });
const land: WorkStage = { id: "land", kind: "skill", skill: "", name: "Commit, PR", executors: [], automation: { source: "flow", steps: ["git.create-pr"] } };
const testing = stage("testing", { skill: "testing-tdd", name: "Testing" });

const fill = (usedTokens: number): ContextFillView => ({ share: usedTokens / 1_000_000, usedTokens, windowTokens: 1_000_000, warnTokens: 150_000, alertTokens: 300_000 });
const CATALOG = [{ model: "claude-opus-4-1" }, { model: "claude-sonnet-4-5" }];

type Options = { stages?: WorkStage[]; used?: number | null; model?: string | null; catalog?: ReadonlyArray<{ model: string }> | null; noBoundary?: boolean };

const setup = (options: Options = {}) => {
  const settings: StageSettings = { stages: options.stages ?? [review, implement, testing], minButtonWidth: 170 };
  const calls: string[] = [];
  const sent: string[] = [];
  // Модель живого треда: смена модели границей видна следующему плану.
  let model: string | null = options.model === undefined ? "claude-opus-4-1" : options.model;
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        wait: async () => (calls.push("wait"), { matched: true }),
        compact: async () => (calls.push("compact"), { ok: true }),
        update: async (args: { model?: string | null | undefined }) => {
          calls.push(`update:${args.model}`);
          if (typeof args.model === "string") model = args.model;
          return {};
        },
      },
    },
  });
  const sendPlain = async (_threadId: string, text: string) => {
    calls.push("send");
    sent.push(text);
  };
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
  const boundary = createBoundary({ threads: bb.sdk.threads, send: sendPlain, stageState: (threadId, stageId) => stageStateOf(progress, threadId, stageId), warn: () => undefined });
  let advance: (threadId: string) => void = () => undefined;
  const steps = Object.fromEntries(STEP_IDS.map((id) => [id, async (): Promise<StepOutcome> => ({ ok: true, detail: null })])) as unknown as Steps;
  const thread = async () => ({ active: true, providerId: "claude-code", environmentId: null });
  let relay = createAgentRelay({ busy: () => false, alive: async () => false, send: async () => undefined, onError: () => undefined });
  // Реплика Flow в тред идёт через обёртку: назначенная граница обслуживается до неё.
  const send = async (threadId: string, text: string) => {
    await boundary.service(threadId);
    await sendPlain(threadId, text);
  };
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
    retry: () => ({ seconds: 0, attempts: 0 }),
    wake: (threadId, text) => relay.deliver(threadId, text),
    onError: () => undefined,
  });
  // Вызов flow_stage идёт, пока агент в ходе: тред active, и реплика сперва ложится в ожидание вызова.
  relay = createAgentRelay({ busy: (threadId) => runner.busy(threadId), alive: async () => true, send, onError: () => undefined, pollMs: 5 });
  advance = (threadId) => void runner.advance(threadId);
  const used = options.used === undefined ? 100_000 : options.used;
  const catalog = options.catalog === undefined ? CATALOG : options.catalog;
  registerProgress(bb, progress, {
    now: () => T0,
    stages: () => settings,
    windowCost: async () => undefined,
    thread,
    startTimeoutMs: 200,
    relay,
    relayWaitMs: 2000,
    context: async () => (used === null ? null : fill(used)),
    stageModels: createStageModels({ context: async () => (used === null ? null : fill(used)), models: async () => (catalog === null ? null : { current: model, models: catalog }) }),
    ...(options.noBoundary === true ? {} : { boundary }),
  });
  const mark = async (id: string, state: "started" | "done") => {
    const answer = (await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: id, state }, { threadId: THREAD })) as { content: Array<{ text: string }> } | string;
    return typeof answer === "string" ? answer : answer.content.map((part) => part.text).join("");
  };
  const markDone = async (id: string) => {
    await mark(id, "started");
    return mark(id, "done");
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 80));
  return { markDone, mark, boundary, calls, sent, settle };
};

describe("flow_stage на границе этапов: агент идёт дальше сам", () => {
  it("контекст ниже порога и та же модель — прежний ответ, граница не назначена", async () => {
    const { markDone, boundary, calls, settle } = setup({ stages: [review, stage("plan", { name: "Plan" })], used: 149_999 });
    const answer = await markDone("review");
    await settle();
    expect(answer).toBe("Stage review marked done.");
    expect(boundary.scheduled(THREAD)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("порога достигает ровно жёлтый — ответ велит закончить ход", async () => {
    const { markDone } = setup({ stages: [review, stage("plan", { name: "Plan" })], used: 150_000 });
    expect(await markDone("review")).toBe('Stage review marked done. End your turn now: Flow compacts the thread and sends you "carry on".');
  });

  it("нет замера контекста и та же модель — прежний ответ", async () => {
    const { markDone, calls, settle } = setup({ stages: [review, stage("plan", { name: "Plan" })], used: null });
    expect(await markDone("review")).toBe("Stage review marked done.");
    await settle();
    expect(calls).toEqual([]);
  });

  it("без границы в зависимостях ответ прежний, даже когда контекст большой", async () => {
    const { markDone } = setup({ stages: [review, stage("plan", { name: "Plan" })], used: 500_000, noBoundary: true });
    expect(await markDone("review")).toBe("Stage review marked done.");
  });
});

describe("flow_stage на границе этапов: Flow обслуживает тред", () => {
  it("выше порога и модель реализации другая — сжатие, модель, потом «продолжай»", async () => {
    const { markDone, calls, sent, settle } = setup({ used: 200_000 });
    const answer = await markDone("review");
    expect(answer).toBe(
      'Stage review marked done. End your turn now: Flow compacts the thread, sets the model of stage implement "Implementation" and sends you "carry on".',
    );
    await settle();
    expect(calls).toEqual(["wait", "compact", "update:claude-sonnet-4-5", "send"]);
    expect(sent).toEqual(['Flow: the stage boundary is serviced — carry on with stage implement "Implementation".']);
  });

  it("контекст в норме, но следующий этап на другой модели — только смена модели", async () => {
    const { markDone, calls, settle } = setup({ used: 10_000 });
    expect(await markDone("review")).toBe('Stage review marked done. End your turn now: Flow sets the model of stage implement "Implementation" and sends you "carry on".');
    await settle();
    expect(calls).toEqual(["wait", "update:claude-sonnet-4-5", "send"]);
  });

  it("тред уже на модели нужной роли — модель не трогается", async () => {
    const { markDone, calls, settle } = setup({ stages: [implement, testing], used: 10_000, model: "claude-sonnet-4-5" });
    expect(await markDone("implement")).toBe("Stage implement marked done.");
    await settle();
    expect(calls).toEqual([]);
  });

  it("нужной модели нет в каталоге — модель не трогается, сжатие по контексту остаётся", async () => {
    const { markDone, calls, settle } = setup({ used: 200_000, catalog: [{ model: "claude-opus-4-1" }] });
    expect(await markDone("review")).toBe('Stage review marked done. End your turn now: Flow compacts the thread and sends you "carry on".');
    await settle();
    expect(calls).toEqual(["wait", "compact", "send"]);
  });

  it("тред не Claude Code — каталога нет, модель не трогается", async () => {
    const { markDone, calls, settle } = setup({ used: 10_000, catalog: null });
    expect(await markDone("review")).toBe("Stage review marked done.");
    await settle();
    expect(calls).toEqual([]);
  });

  it("после реализации Opus-этап возвращает Opus", async () => {
    const { markDone, calls, settle } = setup({ stages: [implement, stage("plan", { name: "Plan" })], used: 10_000, model: "claude-sonnet-4-5" });
    await markDone("implement");
    await settle();
    expect(calls).toEqual(["wait", "update:claude-opus-4-1", "send"]);
  });
});

describe("flow_stage на границе этапов: впереди автоматизация", () => {
  it("вызов её не ждёт: ответ велит закончить ход, а сжатие и модель идут перед будящей репликой", async () => {
    const { markDone, calls, sent, settle } = setup({ stages: [review, land, implement], used: 200_000 });
    const answer = await markDone("review");
    expect(answer).toContain("Flow started the next stage land");
    expect(answer).toContain('Before the message that wakes you, Flow compacts the thread and sets the model of stage implement "Implementation".');
    await settle();
    expect(calls.indexOf("compact")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("compact")).toBeLessThan(calls.indexOf("update:claude-sonnet-4-5"));
    expect(calls.indexOf("update:claude-sonnet-4-5")).toBeLessThan(calls.lastIndexOf("send"));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("implement");
  });

  it("за автоматизацией нет работы агента — граница не назначается и вызов ждёт реплику как раньше", async () => {
    const { markDone, boundary, calls } = setup({ stages: [review, land], used: 500_000 });
    const answer = await markDone("review");
    expect(boundary.scheduled(THREAD)).toBe(false);
    expect(answer).not.toContain("Before the message");
    expect(calls).toEqual([]);
  });
});

describe("flow_stage: модель этапа при доработке", () => {
  it("«начат» на этапе другой модели — ответ велит закончить ход, Flow ставит модель и шлёт «продолжай»", async () => {
    const { mark, calls, sent, settle } = setup({ stages: [review, implement], used: 10_000 });
    expect(await mark("review", "started")).toBe("Stage review marked started.");
    await mark("review", "done");
    await settle();
    calls.length = 0;
    sent.length = 0;
    // Доработка: агент снова начинает реализацию; тред после границы уже на Sonnet.
    await mark("implement", "started");
    const rework = await mark("review", "started");
    expect(rework).toBe('Stage review marked started. End your turn now: Flow sets the model of stage review "Review" and sends you "carry on".');
    await settle();
    expect(calls).toEqual(["wait", "update:claude-opus-4-1", "send"]);
    expect(sent[0]).toContain('carry on with stage review "Review"');
  });

  it("«начат» на этапе той же модели — прежний ответ", async () => {
    const { mark, calls, settle } = setup({ stages: [review, implement], used: 500_000 });
    expect(await mark("review", "started")).toBe("Stage review marked started.");
    await settle();
    expect(calls).toEqual([]);
  });

  it("после реплики «продолжай» повторный «начат» на том же этапе границу не заводит заново", async () => {
    const { mark, calls, settle } = setup({ stages: [review, implement], used: 10_000, model: "claude-sonnet-4-5" });
    await mark("review", "started");
    await settle();
    expect(calls).toEqual(["wait", "update:claude-opus-4-1", "send"]);
    calls.length = 0;
    // Модель после реплики не сменилась (сбой): агент снова зовёт «начат» — второй раз концом хода его не гоняем.
    expect(await mark("review", "started")).toBe("Stage review marked started.");
    await settle();
    expect(calls).toEqual([]);
  });

  it("тред вернулся на ту Opus, что стояла до реализации", async () => {
    const { markDone, mark, calls, settle } = setup({ stages: [review, implement, testing, stage("plan", { name: "Plan" })], used: 10_000, model: "claude-opus-4-5", catalog: [{ model: "claude-opus-4-1" }, { model: "claude-opus-4-5" }, { model: "claude-sonnet-4-5" }] });
    await markDone("review");
    await settle();
    await mark("implement", "started");
    await mark("implement", "done");
    await mark("testing", "started");
    await mark("testing", "done");
    await settle();
    expect(calls.filter((call) => call.startsWith("update"))).toEqual(["update:claude-sonnet-4-5", "update:claude-opus-4-5"]);
  });

  it("строка про незапущенную автоматизацию за этапом агента не пропадает вместе с границей", async () => {
    const { markDone } = setup({ stages: [review, implement, land], used: 10_000 });
    const answer = await markDone("review");
    expect(answer).toContain("The next stage implement is open;");
    expect(answer).toContain('End your turn now: Flow sets the model of stage implement "Implementation"');
  });
});
