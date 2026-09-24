// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { report, stage, stagedBrief } from "../core/stages-fixtures";
import type { DecisionAnswer, DecisionBrief, FlowProgress, WorkStage } from "../shared/contract";
import { registerApi } from "./api";
import { createProgress } from "./progress";
import { createStore } from "./store";

const T = "2026-09-18T10:00:00.000Z";
const THREAD = "thr_1";

const LIST: WorkStage[] = [
  stage("practice", { name: "Работа" }),
  stage("demo", { kind: "demo", skill: "", name: "Демонстрация" }),
  stage("finish", { name: "Merge", automation: { source: "flow", steps: [] } }),
];

const demoBrief = (patch: Partial<DecisionBrief> = {}): DecisionBrief => ({
  id: "dec_demo",
  threadId: THREAD,
  title: "Демонстрация",
  createdAt: T,
  kind: "brief",
  stages: { list: LIST, minButtonWidth: 170 },
  outcome: { stage: "demo", final: true, done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] },
  questions: [],
  ...patch,
});

const setup = async (brief: DecisionBrief, record: FlowProgress) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  await store.putBrief(brief);
  await bb.storage.kv.set(`flow-progress:${THREAD}`, record);
  registerApi(bb, store, { now: () => T, progress: createProgress(bb.storage.kv) });
  const sends = () => harness.sdk.callsTo("threads.send");
  return { harness, store, sends };
};

describe("ответ на бриф, после которого агенту нечего делать", () => {
  it("демонстрация без комментария агенту не отправляется, но записывается", async () => {
    const brief = demoBrief();
    const { harness, store, sends } = await setup(brief, { stages: { practice: { finishedAt: T } }, waiting: ["demo"] });
    const answer: DecisionAnswer = { briefId: brief.id, answers: [], outcome: { accepted: true } };
    expect(await harness.callRpc("answerBrief", { id: brief.id, answer, messageId: "m" })).toMatchObject({ kind: "accepted" });
    expect(sends()).toHaveLength(0);
    expect((await store.getAnswer(brief.id))?.answer).toEqual(answer);
  });

  it("демонстрация с комментарием уходит агенту репликой", async () => {
    const brief = demoBrief();
    const { harness, sends } = await setup(brief, { stages: { practice: { finishedAt: T } }, waiting: ["demo"] });
    const answer: DecisionAnswer = { briefId: brief.id, answers: [], outcome: { accepted: true, note: "поправь заголовок" } };
    await harness.callRpc("answerBrief", { id: brief.id, answer, messageId: "m" });
    expect(sends()).toHaveLength(1);
  });

  it("демонстрация, за которой остался этап агента, уходит агенту репликой", async () => {
    const brief = demoBrief({ stages: { list: [...LIST, stage("report", { name: "Отчёт" })], minButtonWidth: 170 } });
    const { harness, sends } = await setup(brief, { stages: { practice: { finishedAt: T } }, waiting: ["demo"] });
    await harness.callRpc("answerBrief", { id: brief.id, answer: { briefId: brief.id, answers: [], outcome: { accepted: true } }, messageId: "m" });
    expect(sends()).toHaveLength(1);
  });

  it("бриф с этапами, где ни один этап не взят в прогон, агенту не отправляется", async () => {
    const brief = stagedBrief([report("task"), report("spec"), report("plan")]);
    const { harness, sends } = await setup(brief, { stages: {}, waiting: [] });
    const stages = [
      { id: "task", run: false, executor: "self" },
      { id: "spec", run: false, executor: "self" },
      { id: "plan", run: false, executor: "self" },
    ];
    expect(await harness.callRpc("answerBrief", { id: brief.id, answer: { briefId: brief.id, answers: [], stages }, messageId: "m" })).toMatchObject({ kind: "accepted" });
    expect(sends()).toHaveLength(0);
  });

  it("бриф с этапами, где этап взят в прогон, уходит агенту репликой", async () => {
    const brief = stagedBrief([report("task"), report("spec"), report("plan")]);
    const { harness, sends } = await setup(brief, { stages: {}, waiting: [] });
    const stages = [
      { id: "task", run: true, executor: "self" },
      { id: "spec", run: false, executor: "self" },
      { id: "plan", run: false, executor: "self" },
    ];
    await harness.callRpc("answerBrief", { id: brief.id, answer: { briefId: brief.id, answers: [], stages }, messageId: "m" });
    expect(sends()).toHaveLength(1);
  });
});
