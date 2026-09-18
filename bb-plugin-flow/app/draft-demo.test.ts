import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { emptyDraft, setOutcomeNote, setOutcomeRework, toAnswer } from "./draft";

const brief: DecisionBrief = {
  id: "dec_demo",
  threadId: "thr_1",
  title: "Демонстрация",
  createdAt: "2026-09-16T10:00:00.000Z",
  kind: "brief",
  questions: [],
  outcome: { stage: "demo", final: false, next: "Код", done: ["Сделано"], pending: [], results: [{ label: "x", target: "x" }] },
};

describe("исход Демонстрации в черновике", () => {
  it("пустой комментарий — продолжить", () => {
    expect(toAnswer(brief, emptyDraft()).outcome).toEqual({ accepted: true });
  });

  it("комментарий без выбранной кнопки — на доработку, как главная кнопка", () => {
    expect(toAnswer(brief, setOutcomeNote(emptyDraft(), "переделай")).outcome).toEqual({ accepted: false, note: "переделай" });
  });

  it("«Учесть и продолжить» — принято с комментарием, «На доработку» — не принято", () => {
    const noted = setOutcomeNote(emptyDraft(), "учти");
    expect(toAnswer(brief, setOutcomeRework(noted, false)).outcome).toEqual({ accepted: true, note: "учти" });
    expect(toAnswer(brief, setOutcomeRework(noted, true)).outcome).toEqual({ accepted: false, note: "учти" });
  });
});
