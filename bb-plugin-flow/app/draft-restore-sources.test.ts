// @vitest-environment node
import { describe, expect, it } from "vitest";

import { report, stagedBrief } from "../core/stages-fixtures";
import type { DecisionAnswer, DecisionBrief, RestoredDraft } from "../shared/contract";
import { emptyDraft, initialDraft, type Draft } from "./draft";
import { encodeDraft } from "./draft-storage";
import { shownDraft, withRestored } from "./draft-restore";

const option = (id: string) => ({ id, action: id.toUpperCase(), description: id, recommended: false });

const brief: DecisionBrief = {
  id: "dec_new",
  threadId: "thr_1",
  title: "Бриф заново",
  createdAt: "2026-10-12T10:00:00.000Z",
  kind: "brief",
  setup: { criteria: ["Новый пункт", "Тесты зелёные", "Ченж-лог"] },
  questions: [
    { id: "route", question: "Куда?", kind: "fork", allowOwn: true, options: [option("a"), option("b")] },
    { id: "extras", question: "Что ещё?", kind: "pick", allowOwn: false, options: [option("x"), option("y")] },
  ],
};

const draftOf = (patch: Partial<Draft>) => ({ draft: encodeDraft({ ...emptyDraft(), ...patch }) });
const answerOf = (patch: Partial<DecisionAnswer>): { answer: DecisionAnswer } => ({ answer: { briefId: "dec_old", answers: [], ...patch } });
const restoring = (target: DecisionBrief, restored: RestoredDraft) => withRestored(target, initialDraft(target), restored);

describe("выбор владельца из нескольких свёрнутых виджетов на новом", () => {
  it("вопрос из первого источника и этап из второго ложатся оба", () => {
    const staged = stagedBrief([report("task"), report("spec")], { questions: brief.questions });
    const draft = restoring(staged, {
      sources: [draftOf({ entries: { route: { optionIds: ["b"], own: "" } } }), draftOf({ stages: { spec: { run: true } } })],
    });
    expect(draft.entries.route?.optionIds).toEqual(["b"]);
    expect(draft.stages).toEqual({ spec: { run: true } });
  });

  it("поздний источник ложится поверх раннего в том же вопросе, а нетронутые вопросы раннего остаются", () => {
    const draft = restoring(brief, {
      sources: [
        draftOf({ entries: { route: { optionIds: ["a"], own: "" }, extras: { optionIds: ["x"], own: "" } } }),
        draftOf({ entries: { route: { optionIds: ["b"], own: "" } } }),
      ],
    });
    expect(draft.entries.route?.optionIds).toEqual(["b"]);
    expect(draft.entries.extras?.optionIds).toEqual(["x"]);
  });

  it("ответ тоже источник: записанные выборы ложатся по id вопроса и варианта, чужие id отброшены", () => {
    const draft = restoring(brief, {
      sources: [answerOf({ answers: [{ questionId: "route", optionIds: ["b"] }, { questionId: "gone", optionIds: ["a"] }, { questionId: "extras", optionIds: ["x", "gone"] }] })],
    });
    expect(draft.entries.route?.optionIds).toEqual(["b"]);
    expect(draft.entries.extras?.optionIds).toEqual(["x"]);
    expect(draft.entries.gone).toBeUndefined();
  });

  it("этап, которого в новом виджете нет, отброшен", () => {
    const staged = stagedBrief([report("task")], { questions: brief.questions });
    const draft = restoring(staged, { sources: [draftOf({ stages: { task: { run: true }, gone: { run: true } } })] });
    expect(draft.stages).toEqual({ task: { run: true } });
  });

  it("этап из ответа ложится по id", () => {
    const staged = stagedBrief([report("task"), report("spec")], { questions: brief.questions });
    const draft = restoring(staged, { sources: [answerOf({ stages: [{ id: "spec", run: true, executor: "self", picked: ["run"] }] })] });
    expect(draft.stages).toEqual({ spec: { run: true } });
  });

  it("правки пунктов «Готово, когда» ложатся по тексту: у каждого источника свой список старых пунктов", () => {
    const draft = restoring(brief, {
      sources: [
        { ...draftOf({ criteria: { removed: [0], edited: {}, added: ["Мой пункт"] } }), criteria: ["Тесты зелёные", "Ченж-лог"] },
        { ...answerOf({ criteria: { removed: [], edited: [{ index: 0, text: "Ченж-лог на двух языках" }], added: [] } }), criteria: ["Ченж-лог"] },
      ],
    });
    expect(draft.criteria).toEqual({ removed: [1], edited: { 2: "Ченж-лог на двух языках" }, added: ["Мой пункт"] });
  });

  it("поздний источник, знающий пункт, снимает прежнюю правку: пункт вернули — он не вычеркнут", () => {
    const draft = restoring(brief, {
      sources: [
        { ...draftOf({ criteria: { removed: [0], edited: {}, added: [] } }), criteria: ["Тесты зелёные"] },
        { ...draftOf({ criteria: { removed: [], edited: {}, added: [] } }), criteria: ["Тесты зелёные"] },
      ],
    });
    expect(draft.criteria.removed).toEqual([]);
  });

  it("свои пункты владельца из разных источников не повторяются", () => {
    const same = draftOf({ criteria: { removed: [], edited: {}, added: ["Мой пункт"] } });
    expect(restoring(brief, { sources: [same, same] }).criteria.added).toEqual(["Мой пункт"]);
  });

  it("текст владельца и цена берутся из позднего источника, где они есть; пустой поздний их не стирает", () => {
    const draft = restoring(brief, {
      sources: [draftOf({ note: "заметка", budget: { minutes: "", target: "5", max: "" } }), draftOf({ note: "", budget: { minutes: "", target: "", max: "" } })],
    });
    expect([draft.note, draft.budget.target]).toEqual(["заметка", "5"]);
    const later = restoring(brief, { sources: [draftOf({ note: "заметка" }), draftOf({ note: "новее" })] });
    expect(later.note).toBe("новее");
  });

  it("комментарий к Демонстрации — из позднего источника, где он есть", () => {
    const demo: DecisionBrief = { ...brief, outcome: { stage: "demo", final: false, next: "x", done: [], pending: [], results: [{ label: "a", target: "b" }] } } as DecisionBrief;
    const draft = restoring(demo, { sources: [draftOf({ outcomeNote: "раньше" }), draftOf({}), draftOf({ outcomeNote: "позже" })] });
    expect(draft.outcomeNote).toBe("позже");
    expect(restoring(demo, { sources: [draftOf({ outcomeNote: "раньше" }), draftOf({})] }).outcomeNote).toBe("раньше");
  });

  it("старое поле draft читается как последний источник — позже перечисленных", () => {
    const draft = restoring(brief, { sources: [draftOf({ entries: { route: { optionIds: ["a"], own: "" } } })], ...draftOf({ entries: { route: { optionIds: ["b"], own: "" } } }) });
    expect(draft.entries.route?.optionIds).toEqual(["b"]);
  });

  it("нечитаемые источники пропускаются; ни одного читаемого — бриф открывается как обычно", () => {
    const base = initialDraft(brief);
    const draft = restoring(brief, { sources: [{ draft: "{битый" }, draftOf({ entries: { route: { optionIds: ["b"], own: "" } } })] });
    expect(draft.entries.route?.optionIds).toEqual(["b"]);
    expect(withRestored(brief, base, { sources: [{ draft: "{битый" }, {}] })).toBe(base);
    expect(withRestored(brief, base, { sources: [] })).toBe(base);
  });
});

describe("что владелец видел в неотвеченном виджете группы", () => {
  it("черновик с сервера; нет или нечитаем — начальный вид виджета с выбором, который он принёс", () => {
    const own = draftOf({ entries: { route: { optionIds: ["b"], own: "" } } }).draft;
    expect(shownDraft(brief, own).entries.route?.optionIds).toEqual(["b"]);
    expect(shownDraft(brief, undefined)).toEqual(initialDraft(brief));
    expect(shownDraft(brief, "{битый")).toEqual(initialDraft(brief));
    const carried = { ...brief, restored: draftOf({ entries: { route: { optionIds: ["a"], own: "" } } }) };
    expect(shownDraft(carried, undefined).entries.route?.optionIds).toEqual(["a"]);
  });
});
