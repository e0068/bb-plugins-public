// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { editCriterion, emptyDraft, fromAnswer, removeAddedCriterion, setAddedCriterion, toAnswer, toggleCriterion } from "./draft";

const brief: DecisionBrief = {
  id: "dec_c",
  threadId: "thr_1",
  createdAt: "2026-09-13T00:00:00.000Z",
  title: "Критерий",
  kind: "brief",
  setup: { criteria: ["Первый", "Второй", "Третий"] },
  questions: [],
};

describe("черновик критерия", () => {
  it("нетронутый критерий уходит пустыми правками", () => {
    expect(toAnswer(brief, emptyDraft()).criteria).toEqual({ removed: [], edited: [], added: [] });
  });

  it("крест снимает пункт, повторное нажатие возвращает; номера по порядку брифа", () => {
    const draft = toggleCriterion(toggleCriterion(toggleCriterion(emptyDraft(), 2), 0), 2);
    expect(toAnswer(brief, draft).criteria?.removed).toEqual([0]);
    expect(toAnswer(brief, toggleCriterion(toggleCriterion(emptyDraft(), 2), 0)).criteria?.removed).toEqual([0, 2]);
  });

  it("правка уходит, только если текст изменился, не пустой и пункт не снят", () => {
    const draft = editCriterion(editCriterion(editCriterion(emptyDraft(), 0, "Первый"), 1, "Второй, иначе"), 2, "  ");
    expect(toAnswer(brief, draft).criteria?.edited).toEqual([{ index: 1, text: "Второй, иначе" }]);
    expect(toAnswer(brief, toggleCriterion(draft, 1)).criteria?.edited).toEqual([]);
  });

  it("добавленные пункты: запись за концом списка дописывает, пустые не уходят, крест удаляет", () => {
    const typed = setAddedCriterion(setAddedCriterion(setAddedCriterion(emptyDraft(), 0, "Ещё"), 1, "И ещё"), 0, "Ещё один");
    expect(typed.criteria.added).toEqual(["Ещё один", "И ещё"]);
    expect(toAnswer(brief, setAddedCriterion(typed, 2, " ")).criteria?.added).toEqual(["Ещё один", "И ещё"]);
    expect(removeAddedCriterion(typed, 0).criteria.added).toEqual(["И ещё"]);
  });

  it("у брифа без критерия поля в ответе нет", () => {
    expect(toAnswer({ ...brief, setup: undefined }, toggleCriterion(emptyDraft(), 0))).not.toHaveProperty("criteria");
  });

  it("черновик из ответа возвращает те же правки", () => {
    const draft = setAddedCriterion(editCriterion(toggleCriterion(emptyDraft(), 2), 0, "Иначе"), 0, "Ещё");
    const answer = toAnswer(brief, draft);
    expect(toAnswer(brief, fromAnswer(answer))).toEqual(answer);
  });
});
