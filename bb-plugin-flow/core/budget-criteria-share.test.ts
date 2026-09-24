// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, StageAnswer } from "../shared/contract";
import { forecast, plannedMinutes } from "./budget";
import { add, report, stagedBrief } from "./stages-fixtures";

const brief = stagedBrief([report("plan", { recommended: true, add: add(10, 20, 1, 60) })], {
  planning: { minutes: 30, cost: 6.33 },
  setup: {
    stages: [report("plan", { recommended: true, add: add(10, 20, 1, 60) })],
    criteria: [{ text: "Меню", add: add(3, 5, 1, 20) }, { text: "Витрина", add: add(2, 4, 0, 10) }, "Тесты зелёные"],
  },
  questions: [
    { id: "docs", question: "Документация?", kind: "fork", allowOwn: false, options: [
      { id: "short", action: "Коротко", recommended: true, description: "…", add: add(0, 1, 0, 5) },
      { id: "long", action: "Подробно", recommended: false, description: "…", add: add(2, 4, 0, 15) },
    ] },
  ],
});

const run = (on: boolean): StageAnswer[] => [{ id: "plan", run: on, executor: "self", review: true }];

const answer = (stages: StageAnswer[], removed: number[] = []): DecisionAnswer => ({
  briefId: brief.id,
  answers: [{ questionId: "docs", optionIds: ["short"] }],
  stages,
  criteria: { removed, edited: [], added: [] },
});

describe("края доли пункта", () => {
  const wide = stagedBrief([report("plan", { recommended: true, add: add(10, 12, 0, 20) })], {
    setup: { stages: [report("plan", { recommended: true, add: add(10, 12, 0, 20) })], criteria: [{ text: "Широкий", add: add(3, 8, 0, 60) }] },
  });
  const removedFirst: DecisionAnswer = { briefId: wide.id, answers: [], criteria: { removed: [0], edited: [], added: [] } };

  it("потолок итога не ниже цели, даже когда доля пункта шире цены этапа", () => {
    const f = forecast(wide, removedFirst);
    expect(f.max).toBeGreaterThanOrEqual(f.target);
  });

  it("запланированное время не уходит в минус", () => {
    expect(plannedMinutes(forecast(wide, removedFirst))).toBe(0);
  });

  it("без планирования итог не отрицательный", () => {
    const f = forecast(wide, removedFirst);
    expect(f.target).toBeGreaterThanOrEqual(0);
  });
});

describe("доля пункта при итоге без уже потраченного", () => {
  it("без этапов в прогоне итог — только варианты, пункты его не растят", () => {
    const f = forecast(brief, answer(run(false)));
    expect([f.target, f.max]).toEqual([0, 1]);
    expect(f.lines.map((l) => l.label)).toEqual(["Планирование в треде", "Вопрос 1"]);
  });

  it("с этапом в прогоне пункты не прибавляются к цене этапа", () => {
    const f = forecast(brief, answer(run(true)));
    expect([f.target, f.max]).toEqual([10, 21]);
    expect(f.lines.map((l) => l.label)).not.toContain("Пункт 1");
  });

  it("снятый пункт вычитает свою долю строкой «Снят пункт N»", () => {
    const f = forecast(brief, answer(run(true), [0]));
    expect(f.lines.find((l) => l.label === "Снят пункт 1")).toMatchObject({ target: -3, max: -5, risk: -1, minutes: -20 });
    expect([f.target, f.max]).toEqual([7, 16]);
  });

  it("без этапов в прогоне снятый пункт вычитать не из чего", () => {
    const f = forecast(brief, answer(run(false), [0, 1]));
    expect(f.lines.map((l) => l.label)).not.toContain("Снят пункт 1");
    expect([f.target, f.max]).toEqual([0, 1]);
  });

  it("итог не уходит ниже нуля, сколько бы ни стоил тред", () => {
    const greedy = { ...brief, setup: { ...brief.setup, criteria: [{ text: "Всё", add: add(40, 80, 0, 300) }] } };
    const f = forecast(greedy, { ...answer(run(true), [0]), answers: [] });
    expect([f.target, f.max]).toEqual([0, 0]);
  });
});

describe("цена варианта, снятого владельцем", () => {
  const chose = (ids: string[]): DecisionAnswer => ({
    briefId: brief.id,
    answers: [{ questionId: "docs", optionIds: ids }],
    stages: run(true),
    criteria: { removed: [], edited: [], added: [] },
  });

  it("зачёркнутая рекомендация не приносит в прогноз ни своей цены, ни своей строки", () => {
    const notes = forecast(brief, chose(["long"])).lines.map((l) => l.note);
    expect(notes).toContain("Подробно");
    expect(notes).not.toContain("Коротко");
  });

  it("взятая рекомендация свою строку в разбивку приносит", () => {
    expect(forecast(brief, chose(["short"])).lines.map((l) => l.note)).toContain("Коротко");
  });
});
