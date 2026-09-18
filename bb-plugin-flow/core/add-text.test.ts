// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { addText, criteriaSummary, planningNote } from "./budget";

describe("добавка одной короткой строкой", () => {
  it("доллары диапазоном или числом, риск со знаком и r", () => {
    expect(addText({ target: 2, max: 4, risk: -2 })).toBe("+$2–4 –2r");
    expect(addText({ target: 3, max: 3, risk: 1 })).toBe("+$3 +1r");
  });

  it("не изменяющаяся часть не пишется", () => {
    expect(addText({ target: 2, max: 4, risk: 0 })).toBe("+$2–4");
    expect(addText({ target: 0, max: 0, risk: -1 })).toBe("–1r");
    expect(addText({ target: 0, max: 0, risk: 0 })).toBe("");
  });

  it("пункты, чьи добавки ничего не меняют, сводки не дают", () => {
    const brief: DecisionBrief = { id: "dec_1", threadId: "thr_1", title: "Бриф", createdAt: "2026-09-14T00:00:00.000Z", kind: "brief", setup: { criteria: [{ text: "Ноль", add: { target: 0, max: 0, risk: 0 } }] }, questions: [] };
    expect(criteriaSummary(brief, [])).toBeNull();
  });

  it("сводка «Готово, когда» — тем же форматом", () => {
    const brief: DecisionBrief = {
      id: "dec_1",
      threadId: "thr_1",
      title: "Бриф",
      createdAt: "2026-09-14T00:00:00.000Z",
      kind: "brief",
      setup: { criteria: [{ text: "Кнопка", add: { target: 5, max: 9, risk: 3 } }, { text: "Риск", add: { target: 2, max: 4, risk: -1 } }] },
      questions: [],
    };
    expect(criteriaSummary(brief, [])).toBe("+$7–13 +2r");
    expect(criteriaSummary(brief, [0])).toBe("+$2–4 –1r");
  });
});

describe("вторая строка кнопки бюджета", () => {
  const brief: DecisionBrief = { id: "dec_1", threadId: "thr_1", title: "Бриф", createdAt: "2026-09-14T00:00:00.000Z", kind: "brief", questions: [] };

  it("минуты и стоимость планирования, без стоимости — только минуты, без планирования — ничего", () => {
    expect(planningNote({ ...brief, planning: { minutes: 42, cost: 4.2 } })).toBe("42 мин, $4.2");
    expect(planningNote({ ...brief, planning: { minutes: 42 } })).toBe("42 мин");
    expect(planningNote(brief)).toBeNull();
  });
});
