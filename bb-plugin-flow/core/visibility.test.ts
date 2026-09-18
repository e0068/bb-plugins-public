// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief, DecisionQuestion } from "../shared/contract";
import { answerMessageText, openQuestions } from "./answer-message";
import { hiddenQuestions } from "./visibility";

const question = (id: string, hides: Record<string, string[]> = {}): DecisionQuestion => ({
  id,
  question: `Вопрос ${id}?`,
  kind: "fork",
  allowOwn: false,
  options: ["a", "b"].map((o) => ({ id: o, action: `Вариант ${id}.${o}`, recommended: false, description: "…", add: { target: 0, max: 0, risk: 0 }, ...(hides[o] === undefined ? {} : { hides: hides[o] }) })),
});

const briefOf = (questions: DecisionQuestion[]): DecisionBrief => ({ id: "dec_v", threadId: "thr_1", title: "Скрытые", createdAt: "2026-09-15T00:00:00.000Z", kind: "brief", questions });

const answerOf = (picks: Record<string, string>): DecisionAnswer => ({
  briefId: "dec_v",
  answers: Object.entries(picks).map(([questionId, optionId]) => ({ questionId, optionIds: [optionId] })),
});

describe("hiddenQuestions", () => {
  const brief = briefOf([question("how", { a: ["where"] }), question("where", { a: ["when"] }), question("when")]);

  it("выбранный вариант скрывает помеченный вопрос; другой вариант — нет", () => {
    expect([...hiddenQuestions(brief, answerOf({ how: "a" }))]).toEqual(["where"]);
    expect([...hiddenQuestions(brief, answerOf({ how: "b" }))]).toEqual([]);
  });

  it("выбор внутри скрытого вопроса ничего не скрывает", () => {
    expect([...hiddenQuestions(brief, answerOf({ how: "a", where: "a" }))]).toEqual(["where"]);
  });

  it("вопрос скрывают только выборы вопросов выше него: hides вверх не действует", () => {
    const pair = briefOf([question("x", { a: ["y"] }), question("y", { a: ["x"] })]);
    expect([...hiddenQuestions(pair, answerOf({ x: "a", y: "a" }))]).toEqual(["y"]);
    expect([...hiddenQuestions(pair, answerOf({ x: "b", y: "a" }))]).toEqual([]);
  });

  it("клиент и сервер видят одно скрытое: без ответов скрытых вопросов множество то же", () => {
    const tangled = briefOf([question("p", { a: ["q", "r"] }), question("q", { a: ["p", "r"] }), question("r", { b: ["q"] })]);
    fc.assert(
      fc.property(fc.constantFrom("a", "b"), fc.constantFrom("a", "b"), fc.constantFrom("a", "b"), (p, q, r) => {
        const full = answerOf({ p, q, r });
        const hidden = hiddenQuestions(tangled, full);
        const trimmed = { ...full, answers: full.answers.filter((a) => !hidden.has(a.questionId)) };
        expect([...hiddenQuestions(tangled, trimmed)].sort()).toEqual([...hidden].sort());
        expect(openQuestions(tangled, trimmed)).toEqual([]);
      }),
    );
  });

  it("скрытый вопрос не открыт и не попадает в реплику агенту — при любом выборе", () => {
    fc.assert(
      fc.property(fc.constantFrom("a", "b"), fc.option(fc.constantFrom("a", "b"), { nil: undefined }), (how, when) => {
        const answer = answerOf({ how, ...(when === undefined ? {} : { when }) });
        const hidden = hiddenQuestions(brief, answer);
        const open = openQuestions(brief, answer);
        const text = answerMessageText(brief, answer);
        for (const id of hidden) {
          expect(open).not.toContain(id);
          expect(text).not.toContain(`Вопрос ${id}?`);
        }
      }),
    );
  });
});
