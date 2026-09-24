// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { registerApi } from "./api";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_last";
const settings: StageSettings = { stages: [builtinStage("questions", []), stage("implement", { name: "Реализация" }), builtinStage("demo", [])], minButtonWidth: 170 };

type Row = { id: string; minutes: number | null; cost: number | null };

/** Запись прогона, закрытого до счёта по всем тредам: цена и минуты сняты с одного треда. */
const OLD_RUN = {
  stages: {
    questions: { startedAt: "2026-09-23T22:53:04.327Z", finishedAt: "2026-09-23T23:03:24.955Z", activeMinutes: 1 },
    implement: { startedAt: "2026-09-24T00:11:19.027Z", finishedAt: "2026-09-24T11:24:11.218Z", cost: 6.41, activeMinutes: 14, skipped: false, executor: "self" },
  },
  waiting: [],
  thread: THREAD,
};

const host = async () => {
  let clock = Date.parse("2026-09-24T12:00:00.000Z");
  const now = () => new Date(clock).toISOString();
  const costCalls: string[] = [];
  const minuteCalls: string[] = [];
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  const progress = createProgress(bb.storage.kv);
  registerAskTool(bb, store, { newId: () => "A1", now, stages: () => settings, progress });
  registerApi(bb, store, { now, progress });
  registerProgress(bb, progress, {
    now,
    stages: () => settings,
    windowCost: async (threadId) => (costCalls.push(threadId), 71.2),
    windowMinutes: async (threadId, windows) => (minuteCalls.push(threadId), windows.map((w) => Math.round((w.to - w.from) / 60_000 / 3))),
  });
  const rows = async (threadId = THREAD): Promise<Row[]> => ((await harness.callRpc("getFlowProgress", { threadId })) as { stages: Row[] }).stages;
  return { bb, harness, rows, costCalls, minuteCalls, tick: (minutes: number) => void (clock += minutes * 60_000) };
};

describe("пересчёт этапов, закрытых до счёта по всем тредам", () => {
  it("этап старого прогона на опросе один раз пересчитывается и показывает новые минуты и доллары", async () => {
    const h = await host();
    await h.bb.storage.kv.set(`flow-thread:${THREAD}`, { run: "run_old" });
    await h.bb.storage.kv.set("flow-progress:run_old", OLD_RUN);
    expect((await h.rows()).find((s) => s.id === "implement")).toMatchObject({ minutes: 224, cost: 71.2 });
    const [costs, minutes] = [h.costCalls.length, h.minuteCalls.length];
    expect((await h.rows()).find((s) => s.id === "implement")).toMatchObject({ minutes: 224, cost: 71.2 });
    expect([h.costCalls.length, h.minuteCalls.length]).toEqual([costs, minutes]);
  });

  it("этап без цены цену при пересчёте не получает: считались только минуты", async () => {
    const h = await host();
    await h.bb.storage.kv.set(`flow-thread:${THREAD}`, { run: "run_old" });
    await h.bb.storage.kv.set("flow-progress:run_old", OLD_RUN);
    expect((await h.rows()).find((s) => s.id === "questions")).toMatchObject({ minutes: 3, cost: null });
  });

  it("новый прогон уже считается по всем тредам: опрос после отметки лог заново не читает", async () => {
    const h = await host();
    await h.harness.callAgentTool(ASK_TOOL_NAME, { title: "Бриф", setup: { stages: [{ id: "questions", state: "todo" }, { id: "implement", state: "todo", recommended: true }, { id: "demo", state: "todo", recommended: true }] } }, { threadId: THREAD });
    await h.harness.callRpc("answerBrief", { id: "dec_A1", messageId: "m", answer: { briefId: "dec_A1", answers: [], stages: [{ id: "implement", run: true, executor: "self" }, { id: "demo", run: true, executor: "self" }] } });
    await h.harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "implement", state: "started" }, { threadId: THREAD });
    h.tick(30);
    await h.harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "implement", state: "done" }, { threadId: THREAD });
    await h.rows();
    const [costs, minutes] = [h.costCalls.length, h.minuteCalls.length];
    expect((await h.rows()).find((s) => s.id === "implement")).toMatchObject({ minutes: 10, cost: 71.2 });
    expect([h.costCalls.length, h.minuteCalls.length]).toEqual([costs, minutes]);
  });
});
