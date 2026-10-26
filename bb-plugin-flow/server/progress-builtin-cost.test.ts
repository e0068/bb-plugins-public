// @vitest-environment node
// Встроенные этапы — Вопросы, Definition of Done, Выбор этапов — закрывает ответ владельца, а не отметка агента, и цены у них
// не было: добор берёт окно этапа и минутами, и долларами.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";

const THREAD = "thr_builtin_cost";
const settings: StageSettings = { stages: [builtinStage("questions", []), builtinStage("criteria", []), builtinStage("select", []), stage("implement", { name: "Реализация" })], minButtonWidth: 170 };

type Row = { id: string; minutes: number | null; cost: number | null };

/** Запись нового прогона (считается по всем тредам): Вопросы закрыты ответом владельца, окна есть, цены и минут нет. */
const RUN = {
  stages: {
    questions: { startedAt: "2026-10-26T12:00:00.000Z", finishedAt: "2026-10-26T12:07:00.000Z" },
    criteria: { startedAt: "2026-10-26T12:07:00.000Z", finishedAt: "2026-10-26T12:09:00.000Z" },
  },
  waiting: [],
  thread: THREAD,
  countedAcrossRun: true,
};

/** Один бриф закрыл три встроенных этапа сразу: у них общее окно, а у Выбора этапов окно нулевое. */
const GROUP_RUN = {
  stages: {
    questions: { startedAt: "2026-10-26T12:00:00.000Z", finishedAt: "2026-10-26T12:10:00.000Z" },
    criteria: { startedAt: "2026-10-26T12:00:00.000Z", finishedAt: "2026-10-26T12:10:00.000Z" },
    select: { startedAt: "2026-10-26T12:10:00.000Z", finishedAt: "2026-10-26T12:10:00.000Z" },
  },
  waiting: [],
  thread: THREAD,
  countedAcrossRun: true,
};

const host = async (windowCost: (from: number, to: number) => Promise<number | undefined>, run: object = RUN) => {
  const costCalls: number[] = [];
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const progress = createProgress(bb.storage.kv);
  registerProgress(bb, progress, {
    now: () => "2026-10-26T13:00:00.000Z",
    stages: () => settings,
    windowCost: async (_threadId, from, to) => (costCalls.push(from), windowCost(from, to)),
    windowMinutes: async (_threadId, windows) => windows.map((w) => Math.round((w.to - w.from) / 60_000)),
  });
  await bb.storage.kv.set(`flow-thread:${THREAD}`, { run: "run_new" });
  await bb.storage.kv.set("flow-progress:run_new", run);
  const rows = async (): Promise<Row[]> => ((await harness.callRpc("getFlowProgress", { threadId: THREAD })) as { stages: Row[] }).stages;
  return { harness, rows, costCalls };
};

describe("цена встроенного этапа", () => {
  it("этап, закрытый ответом владельца, получает минуты и доллары своего окна", async () => {
    const h = await host(async (from, to) => (to - from) / 60_000 / 10);
    const rows = await h.rows();
    expect(rows.find((row) => row.id === "questions")).toMatchObject({ minutes: 7, cost: 0.7 });
    expect(rows.find((row) => row.id === "criteria")).toMatchObject({ minutes: 2, cost: 0.2 });
  });

  it("лог не дал долларов — этап остаётся без цены, а минуты на месте", async () => {
    const h = await host(async () => undefined);
    expect((await h.rows()).find((row) => row.id === "questions")).toMatchObject({ minutes: 7, cost: null });
  });

  it("лог долларов не прочёлся (сбой) — то же самое, баннер не падает", async () => {
    const h = await host(async () => {
      throw new Error("нет лога");
    });
    expect((await h.rows()).find((row) => row.id === "questions")).toMatchObject({ minutes: 7, cost: null });
  });

  it("цена кладётся один раз: второй опрос лог не читает", async () => {
    const h = await host(async () => 1);
    await h.rows();
    const before = h.costCalls.length;
    await h.rows();
    expect(h.costCalls.length).toBe(before);
  });

  it("цену этапа, отмеченного агентом, добор не трогает", async () => {
    const h = await host(async () => 5);
    await h.rows();
    await h.harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "implement", state: "started" }, { threadId: THREAD });
    await h.harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "implement", state: "done" }, { threadId: THREAD });
    expect((await h.rows()).find((row) => row.id === "implement")?.cost).toBe(5);
    expect((await h.rows()).find((row) => row.id === "questions")?.cost).toBe(5);
  });

  it("общее окно брифа с несколькими этапами оплачивается один раз — первым этапом группы; минуты у каждого свои", async () => {
    const h = await host(async () => 4, GROUP_RUN);
    const rows = await h.rows();
    expect(rows.find((row) => row.id === "questions")).toMatchObject({ minutes: 10, cost: 4 });
    expect(rows.find((row) => row.id === "criteria")).toMatchObject({ cost: null });
    expect(h.costCalls).toHaveLength(1);
  });

  it("нулевое окно цены не получает, лог за ним не читается", async () => {
    const h = await host(async () => 4, GROUP_RUN);
    expect((await h.rows()).find((row) => row.id === "select")).toMatchObject({ minutes: 0, cost: null });
  });
});
