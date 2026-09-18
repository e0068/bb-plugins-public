// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  answerRecordSchema,
  askDecisionParamsSchema,
  decisionAnswerSchema,
  decisionBriefSchema,
  decisionOptionSchema,
  decisionQuestionSchema,
  decisionsRpcContract,
} from "./contract";

const fullOption = (id: string, recommended = false) => ({
  id,
  action: `Вариант ${id}`,
  recommended,
  description: "Что именно произойдёт",
  cost: "~200k токенов",
  risks: "Приёмку ведёт автор",
});

const shortOption = (id: string, recommended = false) => ({ id, action: `Вариант ${id}`, recommended });

const question = (kind: "toggles" | "choice" | "fork" | "yesno", overrides: Record<string, unknown> = {}) => ({
  id: `q-${kind}`,
  question: "Как поступаем?",
  kind,
  allowOwn: false,
  options: kind === "fork" ? [fullOption("a", true), fullOption("b")] : [shortOption("a", true), shortOption("b")],
  ...overrides,
});

const brief = (overrides: Record<string, unknown> = {}) => ({
  id: "dec_01",
  threadId: "thr_1",
  title: "Как вести работу",
  kind: "brief",
  createdAt: "2026-09-12T12:00:00.000Z",
  questions: [question("toggles"), question("choice"), question("fork")],
  ...overrides,
});

const accepts = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe("контракт брифа", () => {
  it("вариант развилки без описания, цены или рисков отбивается", () => {
    fc.assert(
      fc.property(fc.constantFrom("description", "cost", "risks"), fc.boolean(), (field, blank) => {
        const broken: Record<string, unknown> = { ...fullOption("b") };
        if (blank) broken[field] = "";
        else delete broken[field];
        expect(accepts(decisionQuestionSchema, question("fork", { options: [fullOption("a", true), broken] }))).toBe(false);
      }),
    );
  });

  it("компактный вариант без цены и рисков проходит", () => {
    fc.assert(
      fc.property(fc.constantFrom("toggles", "choice", "yesno") as fc.Arbitrary<"toggles" | "choice" | "yesno">, (kind) => {
        expect(accepts(decisionOptionSchema, shortOption("a"))).toBe(true);
        expect(accepts(decisionQuestionSchema, question(kind))).toBe(true);
      }),
    );
  });

  it("два рекомендованных в choice отбиваются", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 6 }), (extra) => {
        const options = [shortOption("a", true), shortOption("b", true), ...Array.from({ length: extra - 2 }, (_, i) => shortOption(`x${i}`))];
        expect(accepts(decisionQuestionSchema, question("choice", { options }))).toBe(false);
      }),
    );
  });

  it("два рекомендованных в fork отбиваются", () => {
    expect(accepts(decisionQuestionSchema, question("fork", { options: [fullOption("a", true), fullOption("b", true)] }))).toBe(false);
  });

  it("yesno не из двух вариантов отбивается", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }).filter((n) => n !== 2), (n) => {
        const options = Array.from({ length: n }, (_, i) => shortOption(`o${i}`));
        expect(accepts(decisionQuestionSchema, question("yesno", { options }))).toBe(false);
      }),
    );
  });

  it("toggles со своим ответом отбивается", () => {
    expect(accepts(decisionQuestionSchema, question("toggles", { allowOwn: true }))).toBe(false);
  });

  it("вопрос из одного варианта отбивается", () => {
    fc.assert(
      fc.property(fc.constantFrom("toggles", "choice", "fork", "yesno") as fc.Arbitrary<"toggles" | "choice" | "fork" | "yesno">, (kind) => {
        const only = kind === "fork" ? fullOption("a", true) : shortOption("a", true);
        expect(accepts(decisionQuestionSchema, question(kind, { options: [only] }))).toBe(false);
      }),
    );
  });

  it("бриф без вопросов отбивается", () => {
    expect(accepts(decisionBriefSchema, brief({ questions: [] }))).toBe(false);
    expect(accepts(askDecisionParamsSchema, { title: "Пусто", questions: [] })).toBe(false);
  });

  it("clarify из двух вопросов отбивается", () => {
    const yesno = (id: string) => question("yesno", { id });
    expect(accepts(decisionBriefSchema, brief({ kind: "clarify", questions: [yesno("a")] }))).toBe(true);
    expect(accepts(decisionBriefSchema, brief({ kind: "clarify", questions: [yesno("a"), yesno("b")] }))).toBe(false);
  });

  it("повтор варианта в ответе на вопрос отбивается", () => {
    expect(accepts(decisionAnswerSchema, { briefId: "dec_01", answers: [{ questionId: "q", optionIds: ["a", "a"] }] })).toBe(false);
  });

  it("запись ответа с неразборчивой датой отбивается", () => {
    const answer = { briefId: "dec_01", answers: [] };
    expect(accepts(answerRecordSchema, { answer, messageId: "m", answeredAt: "2026-09-12T12:05:00.000Z" })).toBe(true);
    expect(accepts(answerRecordSchema, { answer, messageId: "m", answeredAt: "вчера" })).toBe(false);
  });

  it("текст в десятки тысяч символов проходит без усечения", () => {
    const long = "Очень длинная формулировка. ".repeat(3000);
    const value = brief({
      title: long,
      intro: long,
      questions: [question("fork", { question: long, context: long, options: [{ ...fullOption("a", true), action: long, description: long, cost: long, risks: long }, fullOption("b")] })],
    });
    const parsed = decisionBriefSchema.parse(value);
    expect(parsed.title).toBe(long);
    expect(parsed.questions[0]?.options[0]?.risks).toBe(long);
    expect(decisionAnswerSchema.parse({ briefId: "dec_01", answers: [{ questionId: "q", optionIds: [], own: long }], note: long }).note).toBe(long);
  });

  it("вход и выход обоих методов RPC — схемы zod", () => {
    const stored = decisionBriefSchema.parse(brief());
    const answer = { briefId: "dec_01", answers: [{ questionId: "q-choice", optionIds: ["a"] }] };
    const record = { answer, messageId: "msg_1", answeredAt: "2026-09-12T12:05:00.000Z" };
    const valid = (s: unknown, v: unknown) => (s as { safeParse: (x: unknown) => { success: boolean } }).safeParse(v).success;

    expect(valid(decisionsRpcContract.getBrief.input, { id: "dec_01" })).toBe(true);
    expect(valid(decisionsRpcContract.getBrief.output, { kind: "found", brief: stored, answer: null })).toBe(true);
    expect(valid(decisionsRpcContract.getBrief.output, { kind: "found", brief: stored, answer: record })).toBe(true);
    expect(valid(decisionsRpcContract.getBrief.output, { kind: "not_found" })).toBe(true);
    expect(valid(decisionsRpcContract.answerBrief.input, { id: "dec_01", answer, messageId: "msg_1" })).toBe(true);
    for (const out of [
      { kind: "accepted", record },
      { kind: "already_answered", record },
      { kind: "not_found" },
      { kind: "incomplete", questionIds: ["q-fork"] },
    ]) {
      expect(valid(decisionsRpcContract.answerBrief.output, out)).toBe(true);
    }
    expect(valid(decisionsRpcContract.answerBrief.output, { kind: "accepted" })).toBe(false);
  });
});
