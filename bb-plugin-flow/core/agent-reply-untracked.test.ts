import { describe, expect, it } from "vitest";

import { needsAgentReply } from "./agent-reply";
import { stage } from "./stages-fixtures";
import type { DecisionAnswer, DecisionBrief, FlowProgress, WorkStage } from "../shared/contract";

// Flow пересохранили посреди прогона: этапы начала flow получили новые id, и в записи прогона их нет вовсе.
const LIST: WorkStage[] = [
  stage("stage-new-prototype", { name: "Prototype" }),
  stage("practice", { name: "Работа" }),
  stage("land", { name: "Commit, PR", automation: { source: "flow", steps: [] } }),
  stage("demo", { kind: "demo", skill: "", name: "Демонстрация" }),
  stage("finish", { name: "Merge", automation: { source: "flow", steps: [] } }),
];

const T = "2026-10-03T17:00:00.000Z";

const progress = (done: readonly string[]): FlowProgress => ({ stages: Object.fromEntries(done.map((id) => [id, { finishedAt: T }])), waiting: [] });

const demoBrief = (stageId: string): DecisionBrief => ({
  id: "dec_demo",
  threadId: "thr_1",
  title: "Демонстрация",
  createdAt: T,
  kind: "brief",
  stages: { list: LIST, minButtonWidth: 170 },
  outcome: { stage: stageId, final: false, next: "finish", done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] },
  questions: [],
});

const accepted: DecisionAnswer = { briefId: "dec_demo", answers: [], outcome: { accepted: true } };

describe("работа агента впереди считается после отвеченной Демонстрации", () => {
  it("этап до Демонстрации, которого нет в записи прогона, реплики не требует", () => {
    expect(needsAgentReply(demoBrief("demo"), accepted, progress(["practice", "land", "demo"]))).toBe(false);
  });

  it("этап агента после Демонстрации реплику требует", () => {
    const list = [...LIST, stage("report", { name: "Отчёт" })];
    expect(needsAgentReply({ ...demoBrief("demo"), stages: { list, minButtonWidth: 170 } }, accepted, progress(["practice", "land", "demo"]))).toBe(true);
  });
});
