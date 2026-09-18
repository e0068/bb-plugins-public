// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { BriefSetup, DecisionBrief } from "../shared/contract";
import { answerMessageText, deviationTotal, deviations, openQuestions } from "./answer-message";
import { REVIEW_NONE, REVIEW_ROWS, rowsOf, SETUP_ROW } from "./rows";

const add = (target: number, max: number, risk: number, minutes?: number) => ({ target, max, risk, ...(minutes === undefined ? {} : { minutes }) });

const briefWith = (setup: Record<string, unknown>): DecisionBrief => ({
  id: "dec_1",
  threadId: "thr_1",
  title: "Бриф",
  createdAt: "2026-09-14T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  setup: setup as BriefSetup,
  questions: [],
});

const models = [
  { name: "Fable 5.1", recommended: true, add: add(8, 15, -2, 10) },
  { name: "Opus 5", recommended: false },
];

const brief = briefWith({
  executor: { recommended: "self" },
  checker: { recommended: "agent", adds: { self: add(2, 4, 1, 5) }, models },
  testing: { recommended: "none", adds: { workflow: add(3, 5, -1) }, models },
});

const row = (id: string) => rowsOf(brief).find((r) => r.id === id)!;
const ids = (id: string) => row(id).options.map((o) => o.id);

describe("ревью и тестирование", () => {
  it("ревью и тестирование открываются вариантом Нет", () => {
    for (const id of REVIEW_ROWS) {
      const [first] = row(id).options;
      expect([first?.id, first?.action]).toEqual([REVIEW_NONE, "Нет"]);
    }
  });

  it("варианты тестирования повторяют ревью с моделями", () => {
    expect(ids(SETUP_ROW.testing)).toEqual(ids(SETUP_ROW.checker));
    expect(ids(SETUP_ROW.testing)).toEqual(["none", "self", "agent:Fable 5.1", "agent:Opus 5", "workflow"]);
    expect(row(SETUP_ROW.testing).options.find((o) => o.recommended)?.id).toBe("none");
  });

  it("подписи строк — Исполняет, Ревью, Тестирование", () => {
    expect(rowsOf(brief).map((r) => r.question)).toEqual(["Исполняет", "Ревью", "Тестирование"]);
  });

  it("строки приоритета нет даже у записанного брифа с priority", () => {
    const old = briefWith({ priority: { options: [{ id: "a", action: "А", recommended: true }, { id: "b", action: "Б", recommended: false }] }, executor: { recommended: "self" } });
    expect(rowsOf(old).map((r) => r.id)).toEqual([SETUP_ROW.executor]);
  });

  it("тестирование workflow при исполнителе Сам не закрывает бриф", () => {
    const answer = (testing: string) => ({
      briefId: brief.id,
      answers: [
        { questionId: SETUP_ROW.executor, optionIds: ["self"] },
        { questionId: SETUP_ROW.checker, optionIds: ["none"] },
        { questionId: SETUP_ROW.testing, optionIds: [testing] },
      ],
    });
    expect(openQuestions(brief, answer("workflow"))).toEqual([SETUP_ROW.testing]);
    expect(openQuestions(brief, answer("self"))).toEqual([]);
  });

  it("у Нет нет добавки", () => {
    for (const id of REVIEW_ROWS) expect(row(id).options[0]?.add).toBeUndefined();
    expect(row(SETUP_ROW.checker).options.find((o) => o.id === "self")?.add).toEqual(add(2, 4, 1, 5));
  });
});

describe("порядок и реплика первой части", () => {
  const scale = (...actions: string[]) => ({ options: actions.map((action, i) => ({ id: `o${i}`, action, recommended: i === 1 })) });
  const full = briefWith({
    artifacts: [
      { id: "task", name: "Задача", state: "approved", recommended: false, link: { label: "SL-1", target: "t.md" } },
      { id: "spec", name: "Спека", state: "stale", recommended: true },
    ],
    executor: { recommended: "self" },
    checker: { recommended: "agent", models },
    testing: { recommended: "none", models },
    budgetTarget: scale("—", "$30"),
    budgetMax: scale("—", "$60"),
  });

  it("setup разворачивается в артефакты, исполнителя, ревью, тестирование и старые ряды бюджета", () => {
    expect(rowsOf(full).map((r) => r.id)).toEqual([SETUP_ROW.artifacts, SETUP_ROW.executor, SETUP_ROW.checker, SETUP_ROW.testing, SETUP_ROW.budgetTarget, SETUP_ROW.budgetMax]);
    expect(rowsOf(full).slice(-2).map((r) => [r.question, r.allowOwn])).toEqual([["Целевой бюджет", true], ["Максимальный бюджет", true]]);
  });

  it("строки setup без ответа названы незакрытыми", () => {
    expect(openQuestions(full, { briefId: full.id, answers: [] })).toEqual([SETUP_ROW.artifacts, SETUP_ROW.executor, SETUP_ROW.checker, SETUP_ROW.testing, SETUP_ROW.budgetTarget, SETUP_ROW.budgetMax]);
  });

  it("реплика называет ревью и тестирование, расхождение с рекомендацией — прямо", () => {
    const answer = {
      briefId: full.id,
      answers: [
        { questionId: SETUP_ROW.artifacts, optionIds: ["task", "spec"] },
        { questionId: SETUP_ROW.executor, optionIds: ["self"] },
        { questionId: SETUP_ROW.checker, optionIds: ["none"] },
        { questionId: SETUP_ROW.testing, optionIds: ["agent:Opus 5"] },
        { questionId: SETUP_ROW.budgetTarget, optionIds: [], own: "$25" },
        { questionId: SETUP_ROW.budgetMax, optionIds: ["o1"] },
      ],
    };
    const text = answerMessageText(full, answer);
    expect(text).toContain("3. Ревью — Нет (рекомендовал Сторонний агент на Fable 5.1, выбрано Нет)");
    expect(text).toContain("4. Тестирование — Сторонний агент на Opus 5 (рекомендовал Нет, выбрано Сторонний агент на Opus 5)");
    expect(text).toContain("5. Целевой бюджет — своё — $25");
    expect(deviations(full, answer)).toBe(3);
  });

  it("знаменатель расхождений считает и кнопку бюджета, если у брифа есть прогноз", () => {
    const priced = briefWith({ executor: { recommended: "self" }, criteria: [{ text: "Кнопка", add: add(5, 9, 3) }] });
    expect(deviationTotal(priced)).toBe(2);
    expect(deviationTotal(briefWith({ executor: { recommended: "self" } }))).toBe(1);
  });
});
