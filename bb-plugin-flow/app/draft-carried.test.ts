// @vitest-environment node
import { describe, expect, it } from "vitest";

import { SETUP_ROW, rowsOf } from "../core/rows";
import type { BriefSetup, DecisionAnswer, DecisionBrief } from "../shared/contract";
import { fromAnswer, initialDraft, isPicked, pickOption, toAnswer } from "./draft";

const brief: DecisionBrief = {
  id: "dec_carried",
  threadId: "thr_1",
  title: "Бриф",
  createdAt: "2026-09-14T00:00:00.000Z",
  kind: "brief",
  setup: { executor: { recommended: "self" }, checker: { recommended: "agent", models: [{ name: "Fable 5.1", recommended: true }] }, testing: { recommended: "none" } } as BriefSetup,
  carried: { [SETUP_ROW.checker]: ["self"] },
  questions: [],
};

const row = (id: string) => rowsOf(brief).find((r) => r.id === id)!;

describe("перенос в черновике", () => {
  it("открытый бриф встаёт на перенесённое вместо рекомендации без метки", () => {
    const draft = initialDraft(brief);
    expect(draft.entries[SETUP_ROW.checker]?.optionIds).toEqual(["self"]);
    expect(isPicked(draft, SETUP_ROW.checker)).toBe(false);
  });

  it("строка без переноса стоит на рекомендации", () => {
    const draft = initialDraft(brief);
    expect(draft.entries[SETUP_ROW.executor]?.optionIds).toEqual(["self"]);
    expect(draft.entries[SETUP_ROW.testing]?.optionIds).toEqual(["none"]);
  });

  it("ответ несёт picked только у тронутых строк", () => {
    const answer = toAnswer(brief, pickOption(initialDraft(brief), row(SETUP_ROW.testing), "self", brief));
    const byRow = Object.fromEntries(answer.answers.map((a) => [a.questionId, a.picked]));
    expect(byRow[SETUP_ROW.testing]).toEqual(["self"]);
    expect(byRow[SETUP_ROW.checker]).toBeUndefined();
    expect(Object.keys(answer.answers.find((a) => a.questionId === SETUP_ROW.executor) ?? {})).not.toContain("picked");
  });

  it("черновик из ответа возвращает метки", () => {
    const answer: DecisionAnswer = { briefId: brief.id, answers: [{ questionId: SETUP_ROW.executor, optionIds: ["subagents"], picked: ["subagents"] }, { questionId: SETUP_ROW.checker, optionIds: ["self"] }] };
    const draft = fromAnswer(answer);
    expect(isPicked(draft, SETUP_ROW.executor)).toBe(true);
    expect(isPicked(draft, SETUP_ROW.checker)).toBe(false);
  });
});
