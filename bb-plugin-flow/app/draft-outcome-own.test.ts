import { describe, expect, it } from "vitest";

import type { DecisionBrief, DecisionQuestion } from "../shared/contract";
import { emptyDraft, setOwn, toAnswer } from "./draft";

const fork: DecisionQuestion = {
  id: "fix",
  question: "Чинить находку?",
  kind: "fork",
  allowOwn: true,
  options: [
    { id: "yes", action: "Да", recommended: true, description: "…" },
    { id: "no", action: "Нет", recommended: false, description: "…" },
  ],
};

const brief: DecisionBrief = {
  id: "dec_1",
  threadId: "thr_1",
  title: "Итог",
  createdAt: "2026-10-04T00:00:00.000Z",
  kind: "brief",
  questions: [fork],
  outcome: { stage: "demo", final: true, done: ["Готово"], pending: [], results: [{ label: "x", target: "x" }] },
};

describe("черновик Демонстрации со своим ответом в строке вопроса", () => {
  it("уходит не приёмкой: Демонстрация остаётся открытой", () => {
    expect(toAnswer(brief, setOwn(emptyDraft(), fork, "Что значит собрать документом системы?")).outcome).toEqual({ accepted: false });
  });

  it("свой ответ из пробелов этап принимает", () => {
    expect(toAnswer(brief, setOwn(emptyDraft(), fork, "   ")).outcome).toEqual({ accepted: true });
  });
});
