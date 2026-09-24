// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { awaitingChanges, awaitingKind, waitsForAnswer } from "./awaiting";
import { report } from "./stages-fixtures";

const brief = (patch: Partial<DecisionBrief>): DecisionBrief => ({ id: "dec_1", threadId: "thr_1", title: "Бриф", createdAt: "2026-09-16T10:00:00.000Z", kind: "brief", questions: [], ...patch });
const question = { id: "q", kind: "confirm" as const, question: "Так?", allowOwn: false, options: [{ id: "yes", action: "Да", recommended: true }] };

describe("вид ожидания брифа", () => {
  it("уточнение не ждёт; итог — Демонстрация; дальше Вопросы, Критерии, Выбор этапов по порядку", () => {
    expect(awaitingKind(brief({ kind: "clarify" }))).toBeNull();
    expect(awaitingKind(brief({ outcome: { stage: "demo", final: true, done: ["a"], pending: [], results: [{ label: "a", target: "a" }] } }))).toBe("demo");
    expect(awaitingKind(brief({ questions: [question], setup: { criteria: ["x"], stages: [report("task")] } }))).toBe("questions");
    expect(awaitingKind(brief({ setup: { criteria: ["x"], stages: [report("task")] } }))).toBe("criteria");
    expect(awaitingKind(brief({ setup: { stages: [report("task")] } }))).toBe("select");
  });
});

describe("разница списков ждущих", () => {
  it("новый и сменивший вид тред ставится, ушедший снимается", () => {
    const prev = new Map([["a", "questions"], ["b", "select"], ["c", "demo"]] as const);
    const next = new Map([["a", "questions"], ["b", "demo"], ["d", "criteria"]] as const);
    expect(awaitingChanges(prev, next)).toEqual({ set: [["b", "demo"], ["d", "criteria"]], clear: ["c"] });
  });

  it("применение разницы к прошлому списку даёт новый", () => {
    const list = fc.array(fc.tuple(fc.constantFrom("a", "b", "c", "d"), fc.constantFrom("questions", "criteria", "select", "demo") as fc.Arbitrary<"questions" | "criteria" | "select" | "demo">));
    fc.assert(
      fc.property(list, list, (a, b) => {
        const prev = new Map<string, "questions" | "criteria" | "select" | "demo">(a);
        const next = new Map<string, "questions" | "criteria" | "select" | "demo">(b);
        const { set, clear } = awaitingChanges(prev, next);
        const applied = new Map(prev);
        clear.forEach((id) => applied.delete(id));
        set.forEach(([id, kind]) => applied.set(id, kind));
        expect([...applied.entries()].sort()).toEqual([...next.entries()].sort());
      }),
    );
  });
});

describe("ожидание держит владелец", () => {
  it("бриф ждёт владельца, а ожидание автоматизации и этапа Action снимает сам прогон", () => {
    expect((["questions", "criteria", "select", "demo"] as const).map(waitsForAnswer)).toEqual([true, true, true, true]);
    expect((["automation", "action"] as const).map(waitsForAnswer)).toEqual([false, false]);
  });
});
