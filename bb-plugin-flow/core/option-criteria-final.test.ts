// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { finalCriteria } from "./option-criteria";

const brief: DecisionBrief = {
  id: "dec_final",
  threadId: "thr_1",
  title: "Итог пунктов",
  createdAt: "2026-10-01T00:00:00.000Z",
  kind: "brief",
  setup: { criteria: ["Тесты зелёные", { text: "Кнопка", before: "Два ряда", after: "Одна кнопка" }, { text: "Риск числом", add: { target: 1, max: 2, risk: 0 } }] },
  questions: [
    { id: "docs", question: "Документация?", kind: "fork", allowOwn: false, options: [
      { id: "readme", action: "README", recommended: true, description: "…", criteria: ["README описывает витрину"] },
      { id: "look", action: "Сначала посмотреть", recommended: false, description: "…", removes: [0] },
    ] },
  ],
};

const answer = (optionId: string, criteria: DecisionAnswer["criteria"] = { removed: [], edited: [], added: [] }): DecisionAnswer => ({ briefId: brief.id, answers: [{ questionId: "docs", optionIds: [optionId] }], criteria });

describe("итоговый список «Готово, когда» ответа", () => {
  it("пункты брифа, затем пункты выбранного варианта", () => {
    expect(finalCriteria(brief, answer("readme"))).toEqual(["Тесты зелёные", "Кнопка", "Риск числом", "README описывает витрину"]);
  });

  it("снятый владельцем пункт выпадает, правка заменяет текст, дописанный встаёт следом", () => {
    expect(finalCriteria(brief, answer("readme", { removed: [2], edited: [{ index: 0, text: "Все тесты зелёные" }], added: ["Свой пункт"] }))).toEqual([
      "Все тесты зелёные",
      "Кнопка",
      "Свой пункт",
      "README описывает витрину",
    ]);
  });

  it("пункт, снятый вариантом, выпадает", () => {
    expect(finalCriteria(brief, answer("look"))).toEqual(["Кнопка", "Риск числом"]);
  });

  it("правка пункта-изменения — новое «стало»: в итоге пункт назван своим текстом и новым «стало»", () => {
    expect(finalCriteria(brief, answer("readme", { removed: [], edited: [{ index: 1, text: "Одна кнопка внизу" }], added: [] }))[1]).toBe("Кнопка — Одна кнопка внизу");
  });
});
