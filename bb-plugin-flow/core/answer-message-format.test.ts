// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief, DecisionOption, DecisionQuestion } from "../shared/contract";
import { answerMessageText, deviations } from "./answer-message";

const option = (id: string, recommended = false): DecisionOption => ({ id, action: `Вариант ${id}`, recommended, description: `Описание ${id}` });

const question = (id: string, kind: DecisionQuestion["kind"], options: DecisionOption[], allowOwn = false): DecisionQuestion => ({
  id,
  question: `Вопрос ${id}?`,
  kind,
  allowOwn,
  options,
});

const briefOf = (questions: DecisionQuestion[]): DecisionBrief => ({
  id: "dec_f",
  threadId: "thr_f",
  title: "Формат",
  createdAt: "2026-09-30T10:00:00.000Z",
  kind: "brief",
  questions,
});

const answerOf = (answers: DecisionAnswer["answers"]): DecisionAnswer => ({ briefId: "dec_f", answers });

const fork = question("fork", "fork", [option("self", true), option("pipe")]);
const pick = question("pick", "pick", [option("a", true), option("b", true), option("c", true), option("d")]);
const confirm = question("confirm", "confirm", [{ id: "yes", action: "Yes", recommended: true }]);

const occurrences = (text: string, part: string) => text.split(part).length - 1;

describe("строка ответа называет выбранное один раз", () => {
  it("выбор против рекомендации — выбранное и в скобках только рекомендованное", () => {
    const text = answerMessageText(briefOf([fork]), answerOf([{ questionId: "fork", optionIds: ["pipe"] }]));
    expect(text).toContain("1. Вопрос fork? — Вариант pipe (рекомендовал: Вариант self)");
    expect(occurrences(text, "Вариант pipe")).toBe(1);
    expect(text).not.toContain("выбрано");
  });

  it("выбор по рекомендации идёт без скобок", () => {
    const text = answerMessageText(briefOf([fork]), answerOf([{ questionId: "fork", optionIds: ["self"] }]));
    expect(text.split("\n")).toContain("1. Вопрос fork? — Вариант self");
  });
});

describe("свой текст владельца — цитатой под своим вопросом", () => {
  it("свой текст вместо варианта стоит один раз, цитатой с отступом пункта", () => {
    const text = answerMessageText(briefOf([fork]), answerOf([{ questionId: "fork", optionIds: [], own: "Вдвоём" }]));
    const rows = text.split("\n");
    expect(rows).toContain("1. Вопрос fork? — своё (рекомендовал: Вариант self)");
    expect(rows[rows.indexOf("1. Вопрос fork? — своё (рекомендовал: Вариант self)") + 1]).toBe("   > Вдвоём");
    expect(occurrences(text, "Вдвоём")).toBe(1);
  });

  it("многоабзацный свой текст остаётся цитатой внутри пункта, а следующий пункт идёт после пустой строки", () => {
    const own = "Первый абзац\n\nВторой абзац";
    const text = answerMessageText(briefOf([pick, fork]), answerOf([
      { questionId: "pick", optionIds: ["a", "b", "c"], own },
      { questionId: "fork", optionIds: ["self"] },
    ]));
    expect(text).toContain("1. Вопрос pick? — Вариант a, Вариант b, Вариант c\n   > Первый абзац\n   >\n   > Второй абзац\n\n2. Вопрос fork? — Вариант self");
    expect(occurrences(text, "Первый абзац")).toBe(1);
  });

  it("у пункта с двузначным номером цитата сдвинута под его текст", () => {
    const questions = Array.from({ length: 10 }, (_, i) => question(`q${i}`, "fork", [option(`x${i}`, true), option(`y${i}`)]));
    const answers = questions.map((q, i) => ({ questionId: q.id, optionIds: i === 9 ? [] : [`x${i}`], ...(i === 9 ? { own: "Своё" } : {}) }));
    expect(answerMessageText(briefOf(questions), answerOf(answers))).toContain("10. Вопрос q9? — своё (рекомендовал: Вариант x9)\n    > Своё");
  });
});

describe("вопрос с несколькими ответами называет только разницу с рекомендацией", () => {
  it("не взятое из рекомендованного и взятое сверх него — без повтора всего рекомендованного списка", () => {
    const text = answerMessageText(briefOf([pick]), answerOf([{ questionId: "pick", optionIds: ["a", "d"] }]));
    expect(text).toContain("1. Вопрос pick? — Вариант a, Вариант d (не взято: Вариант b, Вариант c; сверх рекомендации: Вариант d)");
    expect(occurrences(text, "Вариант a")).toBe(1);
  });

  it("только не взятое — без части о взятом сверх", () => {
    const text = answerMessageText(briefOf([pick]), answerOf([{ questionId: "pick", optionIds: ["a", "b"] }]));
    expect(text).toContain("1. Вопрос pick? — Вариант a, Вариант b (не взято: Вариант c)");
  });

  it("весь рекомендованный набор со своим текстом расхождением не считается", () => {
    const answer = answerOf([{ questionId: "pick", optionIds: ["a", "b", "c"], own: "И ещё словарь" }]);
    expect(deviations(briefOf([pick]), answer)).toBe(0);
    expect(answerMessageText(briefOf([pick]), answer)).not.toContain("не взято");
  });

  it("число расхождений равно числу пунктов со скобками разницы", () => {
    const questions = [fork, pick];
    const entry = (q: DecisionQuestion) =>
      fc.option(
        fc.record({
          ids: q.kind === "pick" ? fc.subarray(q.options.map((o) => o.id)) : fc.subarray(q.options.map((o) => o.id), { maxLength: 1 }),
          own: fc.option(fc.stringMatching(/^[а-я]{1,8}$/), { nil: undefined }),
        }).map(({ ids, own }) => ({ questionId: q.id, optionIds: q.kind === "pick" || own === undefined ? ids : [], ...(own === undefined ? {} : { own }) })),
        { nil: null },
      );
    fc.assert(
      fc.property(fc.tuple(...questions.map(entry)), (entries) => {
        const answer = answerOf(entries.filter((e): e is NonNullable<typeof e> => e !== null));
        const marked = answerMessageText(briefOf(questions), answer)
          .split("\n")
          .filter((l) => /^\d+\. /.test(l) && /\((рекомендовал: |не взято: |сверх рекомендации: )/.test(l)).length;
        expect(deviations(briefOf(questions), answer)).toBe(marked);
      }),
    );
  });
});

describe("подтверждение словом языка ответа", () => {
  it("«Yes» в русском ответе — «Да»", () => {
    expect(answerMessageText(briefOf([confirm]), answerOf([{ questionId: "confirm", optionIds: ["yes"] }]))).toContain("1. Вопрос confirm? — Да");
  });

  it("в английском ответе — «Yes»", () => {
    expect(answerMessageText(briefOf([confirm]), answerOf([{ questionId: "confirm", optionIds: ["yes"] }]), "en")).toContain("1. Вопрос confirm? — Yes");
  });
});

describe("английский ответ в том же формате", () => {
  it("рекомендованное, свой текст и разница набора — теми же местами", () => {
    const text = answerMessageText(briefOf([fork, pick]), answerOf([
      { questionId: "fork", optionIds: [], own: "Together" },
      { questionId: "pick", optionIds: ["a", "d"] },
    ]), "en");
    expect(text).toContain("1. Вопрос fork? — own (recommended: Вариант self)\n   > Together\n\n2. Вопрос pick? — Вариант a, Вариант d (not taken: Вариант b, Вариант c; beyond recommendation: Вариант d)");
  });
});
