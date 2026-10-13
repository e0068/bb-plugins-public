// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { emptyDraft, initialDraft, toAnswer, type Draft } from "./draft";
import { encodeDraft } from "./draft-storage";
import { withRestored } from "./draft-restore";

const questions: DecisionBrief = {
  id: "dec_questions",
  threadId: "thr_1",
  title: "Вопросы",
  createdAt: "2026-10-12T10:00:00.000Z",
  kind: "brief",
  questions: [{ id: "route", question: "Куда?", kind: "fork", allowOwn: false, options: [{ id: "a", action: "A", description: "a", recommended: true }] }],
};

const approval: DecisionBrief = {
  id: "dec_approve",
  threadId: "thr_1",
  title: "Утверждение",
  createdAt: "2026-10-12T10:05:00.000Z",
  kind: "brief",
  questions: [],
  outcome: { stage: "approve", final: false, next: "Spec", done: ["Прототип"], pending: [], results: [{ label: "prototype.html", target: "docs/prototype.html" }] },
};

const answered: { answer: DecisionAnswer } = { answer: { briefId: "dec_questions", answers: [{ questionId: "route", optionIds: ["a"] }], note: "побыстрее и попроще" } };
const unsent = (patch: Partial<Draft>) => ({ draft: encodeDraft({ ...emptyDraft(), ...patch }) });

describe("общий комментарий брифа уходит агенту один раз", () => {
  it("после возврата утверждения новое утверждение не несёт комментарий из уже отправленного ответа", () => {
    const draft = withRestored(approval, initialDraft(approval), { sources: [answered] });
    expect(toAnswer(approval, draft).note).toBeUndefined();
  });

  it("бриф с вопросами заново тоже не несёт отправленный комментарий: агент его уже получил", () => {
    const draft = withRestored(questions, initialDraft(questions), { sources: [answered] });
    expect(draft.note).toBe("");
  });

  it("неотправленный комментарий из черновика ложится на бриф с вопросами заново", () => {
    const draft = withRestored(questions, initialDraft(questions), { sources: [unsent({ note: "ещё подумаю" })] });
    expect(draft.note).toBe("ещё подумаю");
  });

  it("неотправленный комментарий не ложится на утверждение: поля для него там нет", () => {
    const draft = withRestored(approval, initialDraft(approval), { sources: [unsent({ note: "ещё подумаю" })] });
    expect(toAnswer(approval, draft).note).toBeUndefined();
  });
});
