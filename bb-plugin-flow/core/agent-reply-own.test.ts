import { describe, expect, it } from "vitest";

import { needsAgentReply } from "./agent-reply";
import { stage } from "./stages-fixtures";
import type { DecisionAnswer, DecisionBrief, FlowProgress } from "../shared/contract";

const T = "2026-10-04T00:00:00.000Z";

const brief: DecisionBrief = {
  id: "dec_demo",
  threadId: "thr_1",
  title: "Демонстрация",
  createdAt: T,
  kind: "brief",
  stages: {
    list: [stage("practice", { name: "Работа" }), stage("demo", { kind: "demo", skill: "", name: "Демонстрация" }), stage("finish", { name: "Archive", automation: { source: "flow", steps: [] } })],
    minButtonWidth: 170,
  },
  outcome: { stage: "demo", final: true, done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] },
  questions: [],
};

const done: FlowProgress = { stages: { practice: { finishedAt: T }, demo: { finishedAt: T } }, waiting: [] };

describe("свой ответ в строке вопроса будит агента", () => {
  it("даже когда впереди остались только автоматизации", () => {
    const answer: DecisionAnswer = { briefId: "dec_demo", answers: [{ questionId: "fix", optionIds: [], own: "Что значит собрать документом системы?" }], outcome: { accepted: true } };
    expect(needsAgentReply(brief, answer, done)).toBe(true);
  });
});
