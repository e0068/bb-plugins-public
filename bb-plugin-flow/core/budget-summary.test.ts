// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { deviationTotal } from "./answer-message";
import { criteriaSummary, ownBudgetText } from "./budget";

const add = (target: number, max: number, risk: number) => ({ target, max, risk });

const brief: DecisionBrief = {
  id: "dec_1",
  threadId: "thr_1",
  title: "Бриф",
  createdAt: "2026-09-13T00:00:00.000Z",
  kind: "brief",
  setup: { executor: { recommended: "self" }, criteria: [{ text: "Кнопка", add: add(5, 9, 3) }, { text: "Риск", add: add(2, 4, -1) }, "Тест"] },
  questions: [],
};

describe("сводка и своя цена", () => {
  it("без оставленных пунктов с добавками сводки у заголовка «Готово, когда» нет", () => {
    expect(criteriaSummary(brief, [0, 1])).toBeNull();
  });

  it("своя цена одним форматом: пустое поле — прочерк, обе пустые — нет своей цены", () => {
    expect(ownBudgetText({ target: "$25", max: "$40" })).toBe("$25 · до $40");
    expect(ownBudgetText({ target: " ", max: "$40" })).toBe("— · до $40");
    expect(ownBudgetText({})).toBeNull();
  });

});
