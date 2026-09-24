import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { emptyDraft, setOutcomeNote, toAnswer } from "./draft";

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

  it("написанный комментарий — не принято, с комментарием", () => {
    expect(toAnswer(brief, setOutcomeNote(emptyDraft(), "почему так?")).outcome).toEqual({ accepted: false, note: "почему так?" });
  });
});
