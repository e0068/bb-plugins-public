// @vitest-environment node
// Что агент предложил в выборе этапов, частью утверждённого прогона не становится, пока владелец не утвердил:
// предложенный к снятию этап остаётся в прогоне, а снятый самим владельцем снят сразу.
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief, FlowProgress } from "../shared/contract";
import { EMPTY_PROGRESS, onAnswer } from "./progress";
import { report, STAGES, stagedBrief } from "./stages-fixtures";

const AT = "2026-10-13T10:00:00.000Z";

const selection = stagedBrief([report("task", { recommended: true }), report("spec"), report("plan", { recommended: true })], {
  stages: { list: [...STAGES, { id: "approve", kind: "approve", skill: "", name: "Approval", executors: [] }], minButtonWidth: 170 },
});

const chosen = (...runs: Array<[string, boolean]>): DecisionAnswer => ({
  briefId: "dec_stages",
  answers: [],
  stages: runs.map(([id, run]) => ({ id, run, executor: "self" })),
});

const approval: DecisionBrief = {
  id: "dec_approve",
  threadId: "thr_1",
  title: "Утверждение — выбор этапов",
  createdAt: AT,
  kind: "brief",
  questions: [],
  outcome: { stage: "approve", final: false, next: "Execution", done: ["Прогон"], pending: [], results: [{ label: "a.md", target: "docs/a.md" }] },
  stages: { list: [{ id: "approve", kind: "approve", skill: "", name: "Approval", executors: [] }], minButtonWidth: 160 },
};

const answer = (outcome: DecisionAnswer["outcome"]): DecisionAnswer => ({ briefId: "dec_approve", answers: [], outcome });

const afterSelection = (): FlowProgress => onAnswer(EMPTY_PROGRESS, selection, chosen(["task", false], ["spec", false], ["plan", true]), AT);

describe("ответ на выбор этапов", () => {
  it("этап, который агент не рекомендовал и владелец оставил снятым, предложен агентом: ждёт утверждения", () => {
    expect(afterSelection().stages.spec).toMatchObject({ skipped: true, proposed: true });
  });

  it("этап, который агент рекомендовал, а владелец снял сам, снят сразу", () => {
    const track = afterSelection().stages.task;
    expect(track?.skipped).toBe(true);
    expect(track?.proposed).toBeUndefined();
  });

  it("этап, взятый в прогон, предложенным не помечается", () => {
    expect(afterSelection().stages.plan?.proposed).toBeUndefined();
  });
});

describe("утверждение после выбора этапов", () => {
  const waiting = (): FlowProgress => ({ ...afterSelection(), waiting: ["approve"] });

  it("утверждение без комментария делает снятие вступившим в силу: этап снят, метки нет", () => {
    const track = onAnswer(waiting(), approval, answer({ accepted: true }), AT).stages.spec;
    expect(track?.skipped).toBe(true);
    expect(track?.proposed).toBeUndefined();
  });

  it("утверждение с комментарием снятие не утверждает: этап остаётся предложенным", () => {
    expect(onAnswer(waiting(), approval, answer({ accepted: false, note: "вернуть этап" }), AT).stages.spec).toMatchObject({ skipped: true, proposed: true });
  });
});
