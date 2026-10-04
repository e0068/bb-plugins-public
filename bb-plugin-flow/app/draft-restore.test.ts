// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { emptyDraft, initialDraft, type Draft } from "./draft";
import { encodeDraft } from "./draft-storage";
import { withRestored } from "./draft-restore";

const option = (id: string) => ({ id, action: id.toUpperCase(), description: id, recommended: false });

const brief: DecisionBrief = {
  id: "dec_new",
  threadId: "thr_1",
  title: "Бриф заново",
  createdAt: "2026-10-02T10:00:00.000Z",
  kind: "brief",
  setup: { criteria: ["Новый пункт", "Тесты зелёные", "Ченж-лог"] },
  questions: [
    { id: "route", question: "Куда?", kind: "fork", allowOwn: true, options: [option("a"), option("b")] },
    { id: "extras", question: "Что ещё?", kind: "pick", allowOwn: false, options: [option("x"), option("y")] },
  ],
};

const returned = (draft: Partial<Draft>, criteria?: string[]) => ({ draft: encodeDraft({ ...emptyDraft(), ...draft }), ...(criteria === undefined ? {} : { criteria }) });

describe("черновик возвращённого брифа на новом брифе", () => {
  it("выбор ложится на вопросы и варианты с теми же id, ушедшие вопросы и варианты отбрасываются", () => {
    const draft = withRestored(brief, initialDraft(brief), returned({
      entries: { route: { optionIds: ["b"], own: "", picked: ["b"] }, extras: { optionIds: ["x", "gone"], own: "" }, removed: { optionIds: ["a"], own: "" } },
    }));
    expect(draft.entries.route).toEqual({ optionIds: ["b"], own: "", picked: ["b"] });
    expect(draft.entries.extras?.optionIds).toEqual(["x"]);
    expect(draft.entries.removed).toBeUndefined();
  });

  it("своё значение владельца переносится, даже если варианта больше нет; пустой выбор — только как «ничего» у вопроса с несколькими ответами", () => {
    const draft = withRestored(brief, initialDraft(brief), returned({
      entries: { route: { optionIds: ["gone"], own: "в обход" }, extras: { optionIds: [], own: "" } },
    }));
    expect(draft.entries.route).toEqual({ optionIds: [], own: "в обход" });
    expect(draft.entries.extras?.optionIds).toEqual([]);
  });

  it("правки пунктов «Готово, когда» ложатся по тексту пункта, а не по номеру; свои пункты владельца остаются", () => {
    const draft = withRestored(brief, initialDraft(brief), returned({
      criteria: { removed: [0], edited: { 1: "Ченж-лог на двух языках" }, added: ["Мой пункт"] },
    }, ["Тесты зелёные", "Ченж-лог"]));
    expect(draft.criteria).toEqual({ removed: [1], edited: { 2: "Ченж-лог на двух языках" }, added: ["Мой пункт"] });
  });

  it("текст владельца, своя цена и комментарий к Демонстрации переносятся", () => {
    const demo: DecisionBrief = { ...brief, outcome: { stage: "demo", final: false, next: "x", done: [], pending: [], results: [{ label: "a", target: "b" }] } } as DecisionBrief;
    const draft = withRestored(demo, initialDraft(demo), returned({ note: "заметка", budget: { minutes: "", target: "5", max: "" }, outcomeNote: "поправь отступы" }));
    expect([draft.note, draft.budget.target, draft.outcomeNote]).toEqual(["заметка", "5", "поправь отступы"]);
  });

  it("без возвращённого или с нечитаемым черновиком бриф открывается как обычно", () => {
    const base = initialDraft(brief);
    expect(withRestored(brief, base)).toBe(base);
    expect(withRestored(brief, base, { draft: "{битый" })).toBe(base);
  });
});
