// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { answerMessageText, deviations } from "./answer-message";
import { forecast, hasForecast } from "./budget";
import { SETUP_ROW } from "./rows";

const add = (target: number, max: number, risk: number) => ({ target, max, risk });

const brief: DecisionBrief = {
  id: "dec_1",
  threadId: "thr_1",
  title: "Бриф",
  createdAt: "2026-09-13T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  setup: {
    artifacts: [
      { id: "task", name: "Задача", state: "approved", recommended: false, link: { label: "SL-1", target: "t.md" }, add: add(9, 9, 9) },
      { id: "spec", name: "Спецификация", state: "missing", recommended: true, add: add(2, 3, -2) },
    ],
    executor: { recommended: "subagents", adds: { subagents: add(3, 5, 1), workflow: add(6, 10, 2) } },
    checker: { recommended: "agent", adds: { self: add(0, 0, 0) }, models: [{ name: "Opus 5", recommended: true, add: add(3, 5, -3) }] },
    criteria: [
      { text: "Кнопка бюджета", before: "Два ряда", after: "Одна кнопка", add: add(5, 9, 3) },
      { text: "Риск числом", add: add(2, 4, 2) },
      "Тест зелёный",
    ],
  },
  questions: [
    { id: "how", question: "Как?", kind: "fork", allowOwn: false, options: [
      { id: "a", action: "Виджет складывает", recommended: true, description: "…", add: add(3, 5, 1) },
      { id: "b", action: "Агент пишет итог", recommended: false, description: "…", add: add(1, 2, 3) },
    ] },
  ],
};

const answer = (patch: Partial<DecisionAnswer> = {}): DecisionAnswer => ({
  briefId: brief.id,
  answers: [
    { questionId: SETUP_ROW.artifacts, optionIds: ["task", "spec"] },
    { questionId: SETUP_ROW.executor, optionIds: ["subagents"] },
    { questionId: SETUP_ROW.checker, optionIds: ["agent:Opus 5"] },
    { questionId: "how", optionIds: ["a"] },
  ],
  criteria: { removed: [], edited: [], added: [] },
  ...patch,
});

describe("прогноз бюджета — сумма выбранного", () => {
  it("снятый пункт и другой выбор пересчитывают прогноз", () => {
    const f = forecast(brief, answer({
      criteria: { removed: [0], edited: [], added: [] },
      answers: [
        { questionId: SETUP_ROW.artifacts, optionIds: [] },
        { questionId: SETUP_ROW.executor, optionIds: ["workflow"] },
        { questionId: SETUP_ROW.checker, optionIds: ["self"] },
        { questionId: "how", optionIds: ["b"] },
      ],
    }));
    expect([f.target, f.max, f.risk]).toEqual([9, 16, 7]);
  });

  it("бриф без добавок прогноза не держит", () => {
    expect(hasForecast(brief)).toBe(true);
    expect(hasForecast({ ...brief, setup: { criteria: ["Тест зелёный"] }, questions: [] })).toBe(false);
  });
});

describe("бюджет и критерий в реплике агенту", () => {
  it("прогноз уходит строкой «Бюджет» с суммой и риском", () => {
    expect(answerMessageText(brief, answer())).toContain("Бюджет — прогноз $18 · до $31, риск +2");
  });

  it("своя цена названа рядом с прогнозом и считается расхождением", () => {
    const own = answer({ budget: { target: "$25", max: "$40" } });
    expect(answerMessageText(brief, own)).toContain("Бюджет — своя цена $25 · до $40 (прогноз $18 · до $31, риск +2)");
    expect(deviations(brief, own)).toBe(deviations(brief, answer()) + 1);
  });

  it("переписанный пункт-изменение уходит как новое «стало»", () => {
    const text = answerMessageText(brief, answer({ criteria: { removed: [], edited: [{ index: 0, text: "Одна кнопка и разбивка" }], added: [] } }));
    expect(text).toContain("переписан пункт 1 «Кнопка бюджета» — стало «Одна кнопка и разбивка»");
  });
});
