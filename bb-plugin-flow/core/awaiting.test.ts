// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief } from "../shared/contract";
import { actionAwaitingId, automationAwaitingId, awaitingChanges, awaitingKind, awaitingStageId, isStageAwaitingId, ownStageIcon, waitsForAnswer } from "./awaiting";
import { report } from "./stages-fixtures";

const brief = (patch: Partial<DecisionBrief>): DecisionBrief => ({ id: "dec_1", threadId: "thr_1", title: "Бриф", createdAt: "2026-09-16T10:00:00.000Z", kind: "brief", questions: [], ...patch });
const question = { id: "q", kind: "confirm" as const, question: "Так?", allowOwn: false, options: [{ id: "yes", action: "Да", recommended: true }] };

describe("вид ожидания брифа", () => {
  it("уточнение и Демонстрация не ждут; итог Утверждения ждёт; дальше Вопросы, Критерии, Выбор этапов по порядку", () => {
    const outcome = (stage: string) => ({ stage, final: true, done: ["a"], pending: [], results: [{ label: "a", target: "a" }] });
    const list = [builtinStage("demo", []), builtinStage("approve", [])];
    expect(awaitingKind(brief({ kind: "clarify" }))).toBeNull();
    expect(awaitingKind(brief({ stages: { list, minButtonWidth: 170 }, outcome: outcome("demo") }))).toBeNull();
    expect(awaitingKind(brief({ stages: { list, minButtonWidth: 170 }, outcome: outcome("approve") }))).toBe("approve");
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

describe("этап ожидания автоматизации и Action", () => {
  it("ожидание автоматизации и Action называет свой этап, бриф — никакого", () => {
    expect(awaitingStageId({ briefId: automationAwaitingId("land"), kind: "automation" })).toBe("land");
    expect(awaitingStageId({ briefId: actionAwaitingId("deploy"), kind: "action" })).toBe("deploy");
    expect(awaitingStageId({ briefId: "dec_1", kind: "demo" })).toBeNull();
  });

  it("id этапа читается обратно как есть, двоеточие внутри id тоже", () => {
    fc.assert(fc.property(fc.string({ minLength: 1 }), (id) => awaitingStageId({ briefId: automationAwaitingId(id), kind: "automation" }) === id && awaitingStageId({ briefId: actionAwaitingId(id), kind: "action" }) === id));
  });
});

describe("id ожидания этапа и id брифа", () => {
  it("id автоматизации и Action — ожидание этапа при любом id этапа, id брифа — нет", () => {
    fc.assert(fc.property(fc.string(), (id) => isStageAwaitingId(automationAwaitingId(id)) && isStageAwaitingId(actionAwaitingId(id))));
    expect(["dec_1", "dec_mvtgwg69030dac02d5a6", "brief:dec_1"].map(isStageAwaitingId)).toEqual([false, false, false]);
  });
});

describe("своя иконка этапа в строке треда", () => {
  it("этап со своей иконкой отдаёт название и имя иконки, без неё и без этапа — ничего", () => {
    expect(ownStageIcon({ name: "Finalize", icon: "PackageDelivered" })).toEqual({ name: "Finalize", icon: "PackageDelivered" });
    expect(ownStageIcon({ name: "Finalize" })).toBeUndefined();
    expect(ownStageIcon(undefined)).toBeUndefined();
  });
});
