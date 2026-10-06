// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { placedOptionCriteria } from "./option-criteria";

const brief: DecisionBrief = {
  id: "dec_placement",
  threadId: "thr_1",
  title: "Где встаёт пункт варианта",
  createdAt: "2026-10-06T00:00:00.000Z",
  kind: "brief",
  setup: { criteria: ["Первый", "Второй", "Третий"] },
  questions: [
    { id: "what", question: "Что?", kind: "fork", allowOwn: false, options: [
      { id: "plain", action: "Простое", recommended: false, description: "…", criteria: ["Свой пункт простого"] },
      { id: "alt", action: "Вместо второго", recommended: false, description: "…", criteria: ["Замена второму"], removes: [1] },
      { id: "wide", action: "Вместо первого и третьего", recommended: false, description: "…", criteria: ["Замена обоим"], removes: [0, 2] },
      { id: "far", action: "Мимо списка", recommended: false, description: "…", criteria: ["Снял несуществующий"], removes: [7] },
    ] },
  ],
};

const choose = (optionId: string): DecisionAnswer => ({ briefId: brief.id, answers: [{ questionId: "what", optionIds: [optionId] }], criteria: { removed: [], edited: [], added: [] } });

describe("место пункта варианта в списке Definition of Done", () => {
  it("вариант без снятых пунктов встаёт в хвост списка", () => {
    expect(placedOptionCriteria(brief, choose("plain")).map((c) => [c.text, c.under])).toEqual([["Свой пункт простого", null]]);
  });

  it("вариант, снявший пункт, встаёт под ним", () => {
    expect(placedOptionCriteria(brief, choose("alt")).map((c) => [c.text, c.under])).toEqual([["Замена второму", 1]]);
  });

  it("вариант, снявший несколько пунктов, встаёт под последним из них", () => {
    expect(placedOptionCriteria(brief, choose("wide")).map((c) => c.under)).toEqual([2]);
  });

  it("снятый номер за краем списка не прячет пункт: он уходит в хвост", () => {
    expect(placedOptionCriteria(brief, choose("far")).map((c) => c.under)).toEqual([null]);
  });

  it("зачёркнутый отказ от рекомендации встаёт так же, как встал бы выбранный", () => {
    const withRecommended: DecisionBrief = { ...brief, questions: [{ ...brief.questions[0]!, options: brief.questions[0]!.options.map((o) => (o.id === "alt" ? { ...o, recommended: true } : o)) }] };
    const placed = placedOptionCriteria(withRecommended, choose("plain"));
    expect(placed.map((c) => [c.text, c.state, c.under])).toEqual([["Свой пункт простого", "live", null], ["Замена второму", "struck", 1]]);
  });
});
