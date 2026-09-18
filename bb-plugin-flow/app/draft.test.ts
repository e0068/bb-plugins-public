// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { decisionAnswerSchema, type DecisionBrief, type DecisionOption, type DecisionQuestion } from "../shared/contract";
import { acceptRecommendations, decidedCount, emptyDraft, pickOption, setNote, setOwn, toAnswer, type Draft } from "./draft";

const option = (id: string, recommended = false): DecisionOption => ({
  id,
  action: `Действие ${id}`,
  recommended,
  description: "описание",
  cost: "цена",
  risks: "риски",
});

const q = (id: string, kind: DecisionQuestion["kind"], options: DecisionOption[], allowOwn = false): DecisionQuestion => ({
  id,
  question: `${id}?`,
  kind,
  allowOwn,
  options,
});

const toggles = q("artifacts", "toggles", [option("task", true), option("spec", true), option("proto")]);
const choice = q("priority", "choice", [option("speed"), option("quality", true), option("price")]);
const budget = q("budget", "choice", [option("low"), option("mid", true), option("high"), option("inf")], true);
const fork = q("executor", "fork", [option("self", true), option("pipeline")]);
const yesno = q("merge", "yesno", [option("yes", true), option("no")]);

const brief: DecisionBrief = {
  id: "dec_1",
  threadId: "thr_1",
  title: "Бриф",
  createdAt: "2026-09-12T12:00:00.000Z",
  kind: "brief",
  questions: [toggles, choice, budget, fork, yesno],
};

const entry = (draft: Draft, question: DecisionQuestion) => draft.entries[question.id];

const actionArb = fc.oneof(
  fc.tuple(fc.constantFrom(...brief.questions), fc.nat()).map(([question, n]) => (d: Draft) =>
    pickOption(d, question, question.options[n % question.options.length]?.id ?? ""),
  ),
  fc.tuple(fc.constantFrom(...brief.questions), fc.constantFrom("", "  ", "своё", "$25")).map(([question, text]) => (d: Draft) =>
    setOwn(d, question, text),
  ),
  fc.constantFrom("", "заметка").map((text) => (d: Draft) => setNote(d, text)),
);

const play = (actions: Array<(d: Draft) => Draft>) => actions.reduce((d, act) => act(d), emptyDraft());

describe("черновик брифа", () => {
  it("пустой черновик не решает ни одного вопроса", () => {
    expect(decidedCount(brief, emptyDraft())).toEqual({ decided: 0, total: 4 });
  });

  it("принятие рекомендаций решает все вопросы брифа", () => {
    const { decided, total } = decidedCount(brief, acceptRecommendations(brief));
    expect(decided).toBe(total);
  });

  it("принятие рекомендаций включает все рекомендованные toggles и только их", () => {
    const accepted = acceptRecommendations(brief);
    expect(entry(accepted, toggles)?.optionIds).toEqual(["task", "spec"]);
    expect(entry(accepted, fork)?.optionIds).toEqual(["self"]);
    expect(entry(accepted, budget)?.own).toBe("");
  });

  it("принятие рекомендаций сохраняет общий текст", () => {
    const draft = setNote(emptyDraft(), "И светлую тему");
    expect(acceptRecommendations(brief, draft).note).toBe("И светлую тему");
  });

  it("принятие рекомендаций не трогает ответ на вопрос без рекомендации", () => {
    const bare = q("naming", "choice", [option("short"), option("long")]);
    const withBare: DecisionBrief = { ...brief, questions: [...brief.questions, bare] };
    const draft = pickOption(pickOption(emptyDraft(), bare, "long"), choice, "speed");
    const accepted = acceptRecommendations(withBare, draft);
    expect(entry(accepted, bare)?.optionIds).toEqual(["long"]);
    expect(entry(accepted, choice)?.optionIds).toEqual(["quality"]);
    expect(decidedCount(withBare, accepted)).toEqual({ decided: 5, total: 5 });
  });

  it("выбор варианта в choice вытесняет прежний", () => {
    const draft = pickOption(pickOption(emptyDraft(), choice, "speed"), choice, "price");
    expect(entry(draft, choice)?.optionIds).toEqual(["price"]);
  });

  it("выбор варианта в toggles добавляется к включённым", () => {
    const draft = pickOption(pickOption(emptyDraft(), toggles, "task"), toggles, "proto");
    expect(entry(draft, toggles)?.optionIds).toEqual(["task", "proto"]);
  });

  it("повторный выбор в toggles выключает", () => {
    const draft = pickOption(pickOption(emptyDraft(), toggles, "task"), toggles, "task");
    expect(entry(draft, toggles)?.optionIds).toEqual([]);
  });

  it("свой текст в fork снимает выбранный вариант", () => {
    const draft = setOwn(pickOption(emptyDraft(), fork, "self"), fork, "Вдвоём");
    expect(entry(draft, fork)).toEqual({ optionIds: [], own: "Вдвоём" });
    const typedBudget = setOwn(pickOption(emptyDraft(), budget, "mid"), budget, "$25");
    expect(entry(typedBudget, budget)).toEqual({ optionIds: [], own: "$25" });
  });

  it("выбор варианта в fork очищает свой текст", () => {
    const draft = pickOption(setOwn(emptyDraft(), fork, "Вдвоём"), fork, "pipeline");
    expect(entry(draft, fork)).toEqual({ optionIds: ["pipeline"], own: "" });
  });

  it("касание toggles без включённых делает вопрос решённым", () => {
    const touched = pickOption(pickOption(emptyDraft(), toggles, "spec"), toggles, "spec");
    expect(decidedCount({ ...brief, questions: [toggles] }, touched)).toEqual({ decided: 1, total: 1 });
  });

  it("ответ из черновика проходит decisionAnswerSchema", () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 30 }), (actions) => {
        const draft = play(actions);
        expect(decisionAnswerSchema.safeParse(toAnswer(brief, draft)).success).toBe(true);
        for (const question of [choice, budget, fork, yesno]) {
          const e = entry(draft, question);
          expect((e?.optionIds.length ?? 0) <= 1).toBe(true);
          if ((e?.own ?? "").trim() !== "") expect(e?.optionIds).toEqual([]);
        }
        expect(entry(draft, toggles)?.own ?? "").toBe("");
      }),
    );
  });
});
