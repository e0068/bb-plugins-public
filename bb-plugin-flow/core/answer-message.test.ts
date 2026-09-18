// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief, DecisionOption, DecisionQuestion } from "../shared/contract";
import { answerMessageText, deviations, isQuestionAnswered, openQuestions } from "./answer-message";

const option = (id: string, recommended = false): DecisionOption => ({
  id,
  action: `Действие ${id}`,
  recommended,
  description: `Описание ${id}`,
  cost: "~100k",
  risks: "мелкие",
});

const q = (id: string, kind: DecisionQuestion["kind"], options: DecisionOption[], allowOwn = false): DecisionQuestion => ({
  id,
  question: `Вопрос ${id}?`,
  kind,
  allowOwn,
  options,
});

const briefOf = (questions: DecisionQuestion[], kind: DecisionBrief["kind"] = "brief"): DecisionBrief => ({
  id: "dec_1",
  threadId: "thr_1",
  title: "Как вести работу",
  createdAt: "2026-09-12T12:00:00.000Z",
  kind,
  questions,
});

const answerOf = (answers: DecisionAnswer["answers"], note?: string): DecisionAnswer => ({
  briefId: "dec_1",
  answers,
  ...(note === undefined ? {} : { note }),
});

const toggles = q("artifacts", "toggles", [option("task", true), option("spec", true), option("proto")]);
const choice = q("priority", "choice", [option("speed"), option("quality", true), option("price")]);
const budget = q("budget", "choice", [option("5"), option("15", true)], true);
const fork = q("executor", "fork", [option("self", true), option("pipeline")]);
const yesno = q("merge", "yesno", [option("yes", true), option("no")]);
const bare = q("naming", "choice", [option("short"), option("long")]);

const lines = (text: string) => text.split("\n").filter((l) => l.trim().length > 0);

describe("полнота ответа", () => {
  it("вопрос не из брифа в ответе делает ответ неполным", () => {
    const brief = briefOf([choice]);
    const answer = answerOf([
      { questionId: "priority", optionIds: ["quality"] },
      { questionId: "ghost", optionIds: ["x"] },
    ]);
    expect(openQuestions(brief, answer)).toEqual(["ghost"]);
  });

  it("строка toggles без записи незакрыта", () => {
    expect(isQuestionAnswered(toggles, undefined)).toBe(false);
    expect(openQuestions(briefOf([toggles]), answerOf([]))).toEqual(["artifacts"]);
  });

  it("строка toggles с пустым выбором закрыта", () => {
    expect(isQuestionAnswered(toggles, { questionId: "artifacts", optionIds: [] })).toBe(true);
  });

  it("одиночный вопрос со своим текстом вместо варианта закрыт", () => {
    expect(isQuestionAnswered(fork, { questionId: "executor", optionIds: [], own: "Сделаю вдвоём с тобой" })).toBe(true);
    expect(isQuestionAnswered(budget, { questionId: "budget", optionIds: [], own: "$25" })).toBe(true);
    expect(isQuestionAnswered(fork, { questionId: "executor", optionIds: [], own: "   " })).toBe(false);
  });

  it("оставленный без ответа yesno не делает бриф неполным", () => {
    expect(openQuestions(briefOf([choice, yesno]), answerOf([{ questionId: "priority", optionIds: ["speed"] }]))).toEqual([]);
  });
});

describe("текст ответа агенту", () => {
  it("текст ответа на бриф из одного вопроса называет вопрос и выбранное дословно", () => {
    const text = answerMessageText(briefOf([fork]), answerOf([{ questionId: "executor", optionIds: ["self"] }]));
    expect(text).toContain("Вопрос executor?");
    expect(text).toContain("Действие self");
  });

  it("текст ответа на бриф из девяти вопросов держит по строке на вопрос в порядке брифа", () => {
    const questions = Array.from({ length: 9 }, (_, i) => q(`q${i}`, "choice", [option(`a${i}`, true), option(`b${i}`)]));
    const answer = answerOf(questions.map((x, i) => ({ questionId: x.id, optionIds: [`a${i}`] })).reverse());
    const questionLines = lines(answerMessageText(briefOf(questions), answer)).filter((l) => l.includes("Вопрос q"));
    expect(questionLines).toHaveLength(9);
    questionLines.forEach((line, i) => expect(line).toContain(`Вопрос q${i}?`));
  });

  it("включённые toggles перечислены через запятую", () => {
    const text = answerMessageText(briefOf([toggles]), answerOf([{ questionId: "artifacts", optionIds: ["task", "proto"] }]));
    expect(text).toContain("Действие task, Действие proto");
  });

  it("свой текст приводится как есть", () => {
    const own = "Бюджет — «двадцать пять», не больше";
    const text = answerMessageText(briefOf([budget]), answerOf([{ questionId: "budget", optionIds: [], own }]));
    expect(text).toContain(own);
  });

  it("расхождение с рекомендацией названо как рекомендовал X, выбрано Y", () => {
    const text = answerMessageText(briefOf([choice]), answerOf([{ questionId: "priority", optionIds: ["speed"] }]));
    expect(text).toContain("рекомендовал Действие quality, выбрано Действие speed");
  });

  it("свой текст при рекомендации считается расхождением", () => {
    const answer = answerOf([{ questionId: "executor", optionIds: [], own: "Вдвоём" }]);
    expect(deviations(briefOf([fork]), answer)).toBe(1);
    expect(answerMessageText(briefOf([fork]), answer)).toContain("рекомендовал Действие self, выбрано своё — Вдвоём");
  });

  it("подмножество рекомендованных toggles считается расхождением", () => {
    expect(deviations(briefOf([toggles]), answerOf([{ questionId: "artifacts", optionIds: ["task"] }]))).toBe(1);
    expect(deviations(briefOf([toggles]), answerOf([{ questionId: "artifacts", optionIds: ["task", "spec"] }]))).toBe(0);
  });

  it("вопрос без рекомендации не даёт строки расхождения", () => {
    const text = answerMessageText(briefOf([bare]), answerOf([{ questionId: "naming", optionIds: ["long"] }]));
    expect(text).not.toContain("рекомендовал");
  });

  it("общий текст ко всему брифу стоит последним", () => {
    const note = "И не забудь про светлую тему";
    const text = answerMessageText(briefOf([choice, fork]), answerOf([
      { questionId: "priority", optionIds: ["quality"] },
      { questionId: "executor", optionIds: ["self"] },
    ], note));
    expect(lines(text).at(-1)).toContain(note);
  });

  it("число расхождений равно числу строк расхождения в тексте", () => {
    const questions = [toggles, choice, budget, fork, yesno, bare];
    const pick = (question: DecisionQuestion) => {
      const byOptions = fc.subarray(question.options.map((o) => o.id)).map((ids) => ({
        questionId: question.id,
        optionIds: question.kind === "toggles" ? ids : ids.slice(0, 1),
      }));
      const byOwn = fc
        .stringMatching(/^[А-Яа-я0-9 ]*[А-Яа-я0-9][А-Яа-я0-9 ]*$/)
        .map((own) => ({ questionId: question.id, optionIds: [] as string[], own }));
      return question.kind === "toggles"
        ? fc.option(byOptions, { nil: null })
        : fc.option(fc.oneof(byOptions, byOwn), { nil: null });
    };
    fc.assert(
      fc.property(fc.tuple(...questions.map(pick)), (entries) => {
        const answer = answerOf(entries.filter((e): e is NonNullable<typeof e> => e !== null));
        const text = answerMessageText(briefOf(questions), answer);
        const marked = lines(text).filter((l) => l.includes("рекомендовал ")).length;
        expect(deviations(briefOf(questions), answer)).toBe(marked);
      }),
    );
  });
});
