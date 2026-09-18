// @vitest-environment node
import { describe, expect, it } from "vitest";

import { SETUP_ROW, rowsOf } from "../core/rows";
import type { DecisionBrief, DecisionQuestion } from "../shared/contract";
import { acceptRecommendations, decidedCount, emptyDraft, pickOption, setOwn, toAnswer } from "./draft";

const pick: DecisionQuestion = {
  id: "edits",
  question: "Какие правки?",
  kind: "pick",
  allowOwn: false,
  options: [
    { id: "row", action: "Строка дерева", recommended: true, description: "…" },
    { id: "depth", action: "Глубина", recommended: false, description: "…" },
  ],
};

const confirm: DecisionQuestion = {
  id: "read",
  question: "Правильно ли я понял?",
  kind: "confirm",
  allowOwn: false,
  options: [{ id: "yes", action: "Да", recommended: true }],
};

const brief: DecisionBrief = {
  id: "dec_1",
  threadId: "thr_1",
  title: "Бриф",
  createdAt: "2026-09-13T00:00:00.000Z",
  kind: "brief",
  setup: {
    artifacts: [{ id: "plan", name: "План", state: "missing", recommended: true }],
    budgetTarget: { options: [{ id: "none", action: "—", recommended: false }, { id: "b30", action: "$30", recommended: true }] },
  },
  questions: [pick, confirm],
};

const row = (id: string) => rowsOf(brief).find((r) => r.id === id)!;

describe("черновик брифа с первой частью", () => {
  it("принять рекомендации решает и первую часть, и вопросы", () => {
    const accepted = acceptRecommendations(brief);
    expect(decidedCount(brief, accepted)).toEqual({ decided: 4, total: 4 });
    expect(toAnswer(brief, accepted).answers).toEqual([
      { questionId: SETUP_ROW.artifacts, optionIds: ["plan"] },
      { questionId: SETUP_ROW.budgetTarget, optionIds: ["b30"] },
      { questionId: "edits", optionIds: ["row"] },
      { questionId: "read", optionIds: ["yes"] },
    ]);
  });

  it("в pick свой текст складывается с включёнными, а переключение не стирает его", () => {
    const typed = setOwn(pickOption(emptyDraft(), pick, "depth"), pick, "И «Лист»");
    expect(typed.entries.edits).toEqual({ optionIds: ["depth"], own: "И «Лист»" });
    expect(pickOption(typed, pick, "row").entries.edits).toEqual({ optionIds: ["row", "depth"], own: "И «Лист»" });
  });

  it("принять рекомендации не стирает свой текст в pick", () => {
    const typed = setOwn(emptyDraft(), pick, "И «Лист»");
    expect(acceptRecommendations(brief, typed).entries.edits).toEqual({ optionIds: ["row"], own: "И «Лист»" });
  });

  it("в confirm свой текст гасит Да, а Да очищает текст", () => {
    const typed = setOwn(pickOption(emptyDraft(), confirm, "yes"), confirm, "Не совсем");
    expect(typed.entries.read).toEqual({ optionIds: [], own: "Не совсем" });
    expect(pickOption(typed, confirm, "yes").entries.read).toEqual({ optionIds: ["yes"], own: "" });
  });

  it("своя цена вытесняет сегмент бюджета", () => {
    const budget = row(SETUP_ROW.budgetTarget);
    const typed = setOwn(pickOption(emptyDraft(), budget, "b30"), budget, "$25");
    expect(typed.entries[SETUP_ROW.budgetTarget]).toEqual({ optionIds: [], own: "$25" });
  });
});
