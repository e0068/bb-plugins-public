// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { Add, BriefSetup, DecisionAnswer, DecisionBrief } from "../shared/contract";
import { answerMessageText } from "./answer-message";
import { addParts, addText, forecast, hasForecast, minutesText } from "./budget";
import { SETUP_ROW } from "./rows";

const add = (target: number, max: number, risk: number, minutes?: number): Add => ({ target, max, risk, ...(minutes === undefined ? {} : { minutes }) });

const briefWith = (setup: Record<string, unknown>, extra: Partial<DecisionBrief> = {}): DecisionBrief => ({
  id: "dec_1",
  threadId: "thr_1",
  title: "Бриф",
  createdAt: "2026-09-14T00:00:00.000Z",
  kind: "brief",
  setup: setup as BriefSetup,
  questions: [],
  ...extra,
});

describe("части добавки", () => {
  it("деньги экономии пишутся «–$2–4»", () => {
    expect(addParts(add(-4, -2, 0)).money).toBe("–$2–4");
    expect(addParts(add(-3, -3, 0)).money).toBe("–$3");
    expect(addParts(add(2, 4, 0)).money).toBe("+$2–4");
  });

  it("разные знаки пишутся «–$2…+$3»", () => {
    expect(addParts(add(-2, 3, 0)).money).toBe("–$2…+$3");
  });

  it("время пишется «+20 мин» и «–10 мин», без minutes — пусто", () => {
    expect(addParts(add(0, 0, 0, 20)).time).toBe("+20 мин");
    expect(addParts(add(0, 0, 0, -10)).time).toBe("–10 мин");
    expect(addParts(add(0, 0, 0, 0)).time).toBe("");
    expect(addParts(add(1, 2, 0)).time).toBe("");
    expect(minutesText(95)).toBe("95 мин");
  });

  it("знак риска отдельно от текста", () => {
    expect(addParts(add(0, 0, 2)).risk).toEqual({ text: "+2r", sign: 1 });
    expect(addParts(add(0, 0, -1)).risk).toEqual({ text: "–1r", sign: -1 });
    expect(addParts(add(0, 0, 0)).risk).toEqual({ text: "", sign: 0 });
    expect(addText(add(-4, -2, 1, -15))).toBe("–$2–4 +1r –15 мин");
  });
});

describe("разбивка со временем", () => {
  const brief = briefWith(
    {
      executor: { recommended: "self", adds: { subagents: add(3, 6, 1, -20) } },
      checker: { recommended: "agent", models: [{ name: "Fable 5.1", recommended: true, add: add(8, 15, -2, 10) }] },
      testing: { recommended: "self", adds: { self: add(1, 3, -1, 15) } },
      criteria: [{ text: "Кнопка", add: add(5, 9, 2) }],
    },
    { planning: { minutes: 42 } },
  );
  const answer: DecisionAnswer = {
    briefId: brief.id,
    answers: [
      { questionId: SETUP_ROW.executor, optionIds: ["subagents"] },
      { questionId: SETUP_ROW.checker, optionIds: ["agent:Fable 5.1"] },
      { questionId: SETUP_ROW.testing, optionIds: ["self"] },
    ],
  };

  it("планирование без цены — первая строка с минутами и без денег", () => {
    const [first] = forecast(brief, answer).lines;
    expect(first).toEqual({ label: "Планирование в треде", note: "42 мин", minutes: 42, risk: 0, target: null, max: null });
    expect(hasForecast(briefWith({ executor: { recommended: "self" } }, { planning: { minutes: 3 } }))).toBe(true);
  });

  it("строки Ревью и Тестирование в разбивке", () => {
    expect(forecast(brief, answer).lines.map((l) => l.label)).toEqual(["Планирование в треде", "Пункт 1", "Исполняет", "Ревью", "Тестирование"]);
  });

});

describe("сумма выбранного", () => {
  it("складывает пункты критерия, артефакты к работе, исполнителя, ревью и выбранные варианты", () => {
    const brief = briefWith({
      artifacts: [
        { id: "task", name: "Задача", state: "approved", recommended: false, link: { label: "SL-1", target: "t.md" }, add: add(9, 9, 9) },
        { id: "spec", name: "Спецификация", state: "missing", recommended: true, add: add(2, 3, -2) },
      ],
      executor: { recommended: "subagents", adds: { subagents: add(3, 5, 1) } },
      checker: { recommended: "agent", models: [{ name: "Opus 5", recommended: true, add: add(3, 5, -3) }] },
      criteria: [{ text: "Кнопка", add: add(5, 9, 3) }, { text: "Риск", add: add(2, 4, 2) }],
    });
    const f = forecast(brief, {
      briefId: brief.id,
      answers: [
        { questionId: SETUP_ROW.artifacts, optionIds: ["task", "spec"] },
        { questionId: SETUP_ROW.executor, optionIds: ["subagents"] },
        { questionId: SETUP_ROW.checker, optionIds: ["agent:Opus 5"] },
      ],
    });
    // Утверждённая задача работы не добавляет: 5+2 критерии, 2 спецификация, 3 исполнитель, 3 ревью.
    expect([f.target, f.max, f.risk]).toEqual([15, 26, 1]);
    expect(f.lines.map((l) => l.label)).toEqual(["Пункт 1", "Пункт 2", "Артефакты", "Исполняет", "Ревью"]);
  });
});
