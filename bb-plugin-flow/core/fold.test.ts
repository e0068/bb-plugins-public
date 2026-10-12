// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionAnswer, DecisionBrief, ThreadGroup } from "../shared/contract";
import { isApproval, memberSources, nextGroup, restoredOf, restoredSources } from "./fold";

const outcome = (stage: string) => ({ stage, final: true, done: ["a"], pending: [], results: [{ label: "a", target: "a" }] });
const stages = { list: [builtinStage("demo", []), builtinStage("approve", [])], minButtonWidth: 170 };

const brief = (id: string, patch: Partial<DecisionBrief> = {}): DecisionBrief => ({ id, threadId: "thr_1", title: id, createdAt: "2026-10-12T10:00:00.000Z", kind: "brief", questions: [], ...patch });
const question = brief("q", { setup: { criteria: ["Пункт А", "Пункт Б"] } });
const demo = (id: string) => brief(id, { stages, outcome: outcome("demo") });
const approval = (id: string) => brief(id, { stages, outcome: outcome("approve") });
const clarify = (id: string) => brief(id, { kind: "clarify" });

const answer = (briefId: string): DecisionAnswer => ({ briefId, answers: [{ questionId: "route", optionIds: ["a"] }] });

describe("утверждение", () => {
  it("утверждение — итог этапа вида approve; Демонстрация, вопросы и уточнение — нет", () => {
    expect([approval("a"), demo("d"), question, clarify("c")].map(isApproval)).toEqual([true, false, false, false]);
  });
});

describe("группа треда после брифа", () => {
  it("первый бриф треда начинает список", () => {
    expect(nextGroup(null, question)).toEqual({ ids: ["q"], lastApprove: false, folded: false });
  });

  it("бриф дописывается к списку, пока утверждения не было", () => {
    const group: ThreadGroup = { ids: ["a", "b"], lastApprove: false, folded: false };
    expect(nextGroup(group, brief("c"))).toEqual({ ids: ["a", "b", "c"], lastApprove: false, folded: false });
  });

  it("утверждение замыкает группу: оно в списке последним, и список помнит, что последний бриф — утверждение", () => {
    const group: ThreadGroup = { ids: ["a", "b"], lastApprove: false, folded: false };
    expect(nextGroup(group, approval("ok"))).toEqual({ ids: ["a", "b", "ok"], lastApprove: true, folded: false });
  });

  it("бриф после утверждения начинает список заново", () => {
    const group: ThreadGroup = { ids: ["a", "ok"], lastApprove: true, folded: false };
    expect(nextGroup(group, brief("c"))).toEqual({ ids: ["c"], lastApprove: false, folded: false });
  });

  it("два утверждения подряд — каждое в своей группе", () => {
    const group = nextGroup({ ids: ["a", "ok1"], lastApprove: true, folded: true }, approval("ok2"));
    expect(group).toEqual({ ids: ["ok2"], lastApprove: true, folded: false });
  });

  it("свёртка сбрасывается новым виджетом: доработанный бриф снимает запрет утверждения", () => {
    const group: ThreadGroup = { ids: ["a", "ok"], lastApprove: true, folded: true };
    expect(nextGroup(group, brief("c")).folded).toBe(false);
    expect(nextGroup(group, demo("d")).folded).toBe(false);
  });

  it("уточнение доработанным виджетом не считается: свёртка остаётся, а в группу оно входит", () => {
    const group: ThreadGroup = { ids: ["a", "ok"], lastApprove: true, folded: true };
    expect(nextGroup(group, clarify("c"))).toEqual({ ids: ["c"], lastApprove: false, folded: true });
  });

  it("свойство: id нового брифа всегда последний, а после утверждения он в списке один", () => {
    const kinds = fc.constantFrom(question, demo("x"), approval("x"), clarify("x"));
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 4 }), fc.boolean(), fc.boolean(), kinds, fc.string({ minLength: 1 }), (ids, lastApprove, folded, base, id) => {
        const next = nextGroup({ ids, lastApprove, folded }, { ...base, id });
        expect(next.ids.at(-1)).toBe(id);
        if (lastApprove) expect(next.ids).toEqual([id]);
        else expect(next.ids).toEqual([...ids, id]);
      }),
    );
  });
});

describe("источники выбора из членов свёрнутой группы", () => {
  it("отвеченный виджет даёт ответ и тексты своих пунктов", () => {
    expect(memberSources({ brief: question, answer: answer("q"), draft: "{}" })).toEqual([{ answer: answer("q"), criteria: ["Пункт А", "Пункт Б"] }]);
  });

  it("неотвеченный виджет даёт черновик", () => {
    expect(memberSources({ brief: question, answer: null, draft: "{черновик}" })).toEqual([{ draft: "{черновик}", criteria: ["Пункт А", "Пункт Б"] }]);
  });

  it("нетронутый виджет даёт выбор, который сам принёс", () => {
    const restored = { draft: "{раньше}", criteria: ["Пункт А"] };
    expect(memberSources({ brief: { ...question, restored }, answer: null, draft: null })).toEqual([{ draft: "{раньше}", criteria: ["Пункт А"] }]);
    const grouped = { sources: [{ draft: "{1}" }, { answer: answer("z") }] };
    expect(memberSources({ brief: { ...question, restored: grouped }, answer: null, draft: null })).toEqual(grouped.sources);
  });

  it("нетронутый виджет без своего выбора и без брифа — ничего", () => {
    expect(memberSources({ brief: question, answer: null, draft: null })).toEqual([]);
    expect(memberSources({ brief: null, answer: null, draft: null })).toEqual([]);
  });

  it("виджет без пунктов не несёт их текстов", () => {
    expect(memberSources({ brief: brief("p"), answer: null, draft: "{}" })).toEqual([{ draft: "{}" }]);
  });

  it("старая запись возвращённого виджета читается как последний источник", () => {
    expect(restoredSources({ draft: "{старый}", criteria: ["Пункт А"] })).toEqual([{ draft: "{старый}", criteria: ["Пункт А"] }]);
    expect(restoredSources({ draft: "{старый}", sources: [{ draft: "{1}" }] })).toEqual([{ draft: "{1}" }, { draft: "{старый}" }]);
    expect(restoredSources({ sources: [{ draft: "{1}" }] })).toEqual([{ draft: "{1}" }]);
  });

  it("источников нет — выбирать нечего; есть — всегда sources, без особого случая записи прежнего вида", () => {
    expect(restoredOf([])).toBeUndefined();
    expect(restoredOf([{ draft: "{1}", criteria: ["Пункт А"] }])).toEqual({ sources: [{ draft: "{1}", criteria: ["Пункт А"] }] });
    const two = [{ draft: "{1}" }, { answer: answer("z") }];
    expect(restoredOf(two)).toEqual({ sources: two });
  });
});
