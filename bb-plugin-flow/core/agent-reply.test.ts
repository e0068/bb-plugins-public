import { describe, expect, it } from "vitest";

import { needsAgentReply } from "./agent-reply";
import { stage } from "./stages-fixtures";
import type { DecisionAnswer, DecisionBrief, FlowProgress, WorkStage } from "../shared/contract";

const LIST: WorkStage[] = [
  stage("practice", { name: "Работа" }),
  stage("land", { name: "Commit, PR", automation: { source: "flow", steps: [] } }),
  stage("demo", { kind: "demo", skill: "", name: "Демонстрация" }),
  stage("act", { kind: "action", skill: "", name: "Action", automation: { source: "flow", steps: [] } }),
  stage("finish", { name: "Merge", automation: { source: "flow", steps: [] } }),
];

const T = "2026-09-18T10:00:00.000Z";

const progress = (done: readonly string[], skipped: readonly string[] = []): FlowProgress => ({
  stages: Object.fromEntries([...done.map((id) => [id, { finishedAt: T }]), ...skipped.map((id) => [id, { skipped: true }])]),
  waiting: [],
});

const demoBrief = (patch: Partial<DecisionBrief> = {}): DecisionBrief => ({
  id: "dec_demo",
  threadId: "thr_1",
  title: "Демонстрация",
  createdAt: T,
  kind: "brief",
  stages: { list: LIST, minButtonWidth: 170 },
  outcome: { stage: "demo", final: true, done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] },
  questions: [],
  ...patch,
});

const accepted = (note?: string): DecisionAnswer => ({ briefId: "dec_demo", answers: [], outcome: { accepted: true, ...(note === undefined ? {} : { note }) } });

describe("нужна ли агенту реплика об ответе", () => {
  it("не нужна, когда впереди остались только автоматизации и Action", () => {
    expect(needsAgentReply(demoBrief(), accepted(), progress(["practice", "land", "demo"]))).toBe(false);
  });

  it("нужна, когда впереди остался этап агента", () => {
    const brief = demoBrief({ stages: { list: [...LIST, stage("report", { name: "Отчёт" })], minButtonWidth: 170 } });
    expect(needsAgentReply(brief, accepted(), progress(["practice", "land", "demo"]))).toBe(true);
  });

  it("не нужна, когда оставшийся этап агента вычеркнут из прогона", () => {
    const brief = demoBrief({ stages: { list: [...LIST, stage("report", { name: "Отчёт" })], minButtonWidth: 170 } });
    expect(needsAgentReply(brief, accepted(), progress(["practice", "land", "demo"], ["report"]))).toBe(false);
  });

  it("нужна, когда владелец написал комментарий к демонстрации", () => {
    expect(needsAgentReply(demoBrief(), accepted("поправь заголовок"), progress(["practice", "land", "demo"]))).toBe(true);
  });

  it("нужна, когда владелец приложил картинку", () => {
    expect(needsAgentReply(demoBrief(), accepted(), progress(["practice", "land", "demo"]), 1)).toBe(true);
  });

  it("нужна, когда владелец написал своё ко всему брифу", () => {
    const answer: DecisionAnswer = { ...accepted(), note: "и обнови README" };
    expect(needsAgentReply(demoBrief(), answer, progress(["practice", "land", "demo"]))).toBe(true);
  });

  it("уточнение уходит агенту всегда: он ждёт ответа посреди хода", () => {
    const brief = demoBrief({ kind: "clarify", outcome: undefined, questions: [] });
    expect(needsAgentReply(brief, { briefId: "dec_demo", answers: [] }, progress(["practice", "land", "demo"]))).toBe(true);
  });

  it("нужна, когда прогресса треда нет: о работе впереди ничего не известно", () => {
    expect(needsAgentReply(demoBrief(), accepted(), null)).toBe(true);
  });

  it("нужна, когда у брифа нет снимка этапов: тред идёт без flow", () => {
    expect(needsAgentReply(demoBrief({ stages: undefined }), accepted(), progress(["practice", "land", "demo"]))).toBe(true);
  });

  it("не нужна, когда ни один этап не взят в прогон", () => {
    expect(needsAgentReply(demoBrief({ outcome: undefined }), { briefId: "dec_demo", answers: [] }, progress([], ["practice", "land", "demo", "act", "finish"]))).toBe(false);
  });
});
