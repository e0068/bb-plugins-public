import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { decidedCount, emptyDraft, setOutcomeNote, toAnswer } from "./draft";

const brief: DecisionBrief = {
  id: "dec_1",
  threadId: "thr_1",
  title: "Итог",
  createdAt: "2026-09-16T10:00:00.000Z",
  kind: "brief",
  questions: [],
  outcome: {
    stage: "impl",
    final: false,
    next: "Test",
    done: ["Готово"],
    pending: [],
    results: [{ label: "x", target: "x" }],
  },
  stages: { list: [{ id: "impl", skill: "code", name: "Impl", review: true, executors: [] }], minButtonWidth: 160 },
};

describe("черновик брифа с итогом", () => {
  it("счётчик не уходит в минус", () => {
    const { decided, total } = decidedCount(brief, emptyDraft());
    expect(decided).toBeGreaterThanOrEqual(0);
    expect(decided).toBe(total);
  });

  it("пустое поле уходит приёмкой", () => {
    expect(toAnswer(brief, emptyDraft()).outcome).toEqual({ accepted: true });
  });

  it("стёртый до пробелов ответ снова принимает этап", () => {
    expect(toAnswer(brief, setOutcomeNote(emptyDraft(), "   ")).outcome).toEqual({ accepted: true });
  });
});
