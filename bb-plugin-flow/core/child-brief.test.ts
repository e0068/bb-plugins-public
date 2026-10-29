import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief } from "../shared/contract";
import { CHILD_ANSWER_TOOL, asksParent, childAnswerOf, childBriefResult, parentNotice, routesToParent } from "./child-brief";

const stages = { list: [builtinStage("demo", []), builtinStage("approve", ["demo"])], minButtonWidth: 160 };
const outcome = (stage: string) => ({ stage, final: false, done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] });

const approval: DecisionBrief = { id: "dec_ap", threadId: "thr_c", title: "Утверждение", createdAt: "2026-10-27T21:00:00.000Z", kind: "brief", questions: [], outcome: outcome("approve"), stages };
const demo: DecisionBrief = { ...approval, id: "dec_demo", title: "Демо", outcome: outcome("demo") };
const held: DecisionBrief = {
  id: "dec_q",
  threadId: "thr_c",
  title: "Вопросы",
  createdAt: "2026-10-27T21:00:00.000Z",
  kind: "brief",
  questions: [{ id: "q", question: "Где?", kind: "fork", allowOwn: false, options: [{ id: "a", action: "Здесь", recommended: true }, { id: "b", action: "Там", recommended: false }] }],
};
const gathered: DecisionBrief = { ...held, id: "dec_g", settle: "approval" };
const decided: DecisionBrief = { ...held, id: "dec_d", settle: "agent" };
const clarify: DecisionBrief = { ...held, id: "dec_cl", kind: "clarify" };

describe("бриф тред-потомка", () => {
  it("родителю уходит только бриф запуска: Утверждение, Демонстрация и уточнение остаются владельцу", () => {
    expect([held, gathered, decided].map(routesToParent)).toEqual([true, true, true]);
    expect([approval, demo, clarify].map(routesToParent)).toEqual([false, false, false]);
  });

  it("родителя спрашивает бриф, который ход держит или копит ответ; решённый агентом — нет", () => {
    expect([held, gathered, decided].map(asksParent)).toEqual([true, true, false]);
  });

  it("ответ родителя — рекомендованные варианты, комментарий — заметкой ко всему брифу, пробелы не комментарий", () => {
    expect(childAnswerOf(held)).toEqual({ briefId: "dec_q", answers: [{ questionId: "q", optionIds: ["a"] }] });
    expect(childAnswerOf(held, "  ").note).toBeUndefined();
    expect(childAnswerOf(held, " Учти тест ").note).toBe("Учти тест");
  });

  it("реплика родителю называет тред, бриф, рекомендации и инструмент ответа", () => {
    const text = parentNotice("thr_c", held);
    for (const part of ["@thread:thr_c", "dec_q", "Где? → Здесь", CHILD_ANSWER_TOOL]) expect(text).toContain(part);
  });

  it("ответ потомку не несёт строки карточки и говорит, ждать ли родителя", () => {
    expect(childBriefResult(held, "thr_p")).not.toContain("::decision");
    expect(childBriefResult(held, "thr_p")).toContain("End the turn and wait");
    expect(childBriefResult(gathered, "thr_p")).toContain("the parent's answer may arrive along the way");
    expect(childBriefResult(decided, "thr_p")).toContain("they are the decision");
  });
});
