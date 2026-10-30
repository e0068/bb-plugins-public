// @vitest-environment jsdom
// Вопрос по демо: правки, ответ и «решено ли» у демонстрации с вопросами считаются, как у брифа; без вопросов — только комментарий.
import { beforeEach, describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { memberAnswer, memberDecided, memberEdits, settledInitial } from "./approval-edits";
import { pickOption, setNote } from "./draft";

beforeEach(() => window.localStorage.clear());

const T = "2026-10-29T10:00:00.000Z";
const fork = { id: "bevel", kind: "fork" as const, question: "Чинить фаску?", allowOwn: false, options: [{ id: "fix", action: "Чинить", description: "Да.", recommended: true }, { id: "keep", action: "Оставить", description: "Нет.", recommended: false }] };
const bare = { id: "dec_d", threadId: "thr", title: "Демонстрация", createdAt: T, kind: "brief" as const, settle: "approval" as const, outcome: { stage: "demo", final: false, done: [], pending: [], results: [] } };
const asked: DecisionBrief = { ...bare, questions: [fork] };
const report: DecisionBrief = { ...bare, questions: [] };

describe("демонстрация с вопросами в группе Утверждения", () => {
  it("открывается на рекомендации и правок не даёт; ответ не по рекомендации и комментарий — по правке", () => {
    const draft = settledInitial(asked);
    expect(memberEdits(asked, draft)).toBe(0);
    expect(memberEdits(asked, pickOption(draft, fork, "keep", asked))).toBe(1);
    expect(memberEdits(asked, setNote(pickOption(draft, fork, "keep", asked), "проверь тему"))).toBe(2);
  });

  it("с Утверждением уходит ответ на вопрос и комментарий внутри него", () => {
    const draft = setNote(pickOption(settledInitial(asked), fork, "keep", asked), "проверь тему");
    expect(memberAnswer(asked, draft)).toEqual({ id: "dec_d", answer: { briefId: "dec_d", answers: [{ questionId: "bevel", optionIds: ["keep"] }], note: "проверь тему" } });
  });

  it("развилка без рекомендации ждёт выбора, а демо без вопросов — всегда решена", () => {
    const open: DecisionBrief = { ...asked, questions: [{ ...fork, options: fork.options.map((o) => ({ ...o, recommended: false })) }] };
    expect(memberDecided(open, settledInitial(open))).toBe(false);
    expect(memberDecided(asked, settledInitial(asked))).toBe(true);
    expect(memberDecided(report, settledInitial(report))).toBe(true);
  });

  it("демо без вопросов по-прежнему несёт только комментарий", () => {
    expect(memberAnswer(report, setNote(settledInitial(report), "проверь тему"))).toEqual({ id: "dec_d", note: "проверь тему" });
    expect(memberAnswer(report, settledInitial(report))).toEqual({ id: "dec_d" });
  });
});
