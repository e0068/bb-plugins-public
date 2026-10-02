// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { flowSchema, type WorkStage } from "../shared/contract";
import { dropStage, ownerOf, removeStage, runCascade, stageNumbers, stageScope, subStagesOf, type DropZone } from "./sub-stages";

const stage = (id: string, patch: Partial<WorkStage> = {}): WorkStage => ({ id, kind: "skill", skill: id, name: id, executors: [], ...patch });
const sub = (id: string, parent: string): WorkStage => stage(id, { parent });
const ids = (stages: readonly WorkStage[] | null) => stages?.map((s) => (s.parent === undefined ? s.id : `${s.id}<${s.parent}`)) ?? null;
const valid = (stages: readonly WorkStage[]) => flowSchema.safeParse({ id: "f", name: "F", stages }).success;

// Flow владельца: автоматизации Preview и Restore отдельными этапами вокруг Демонстрации.
const FLAT = [stage("ship"), stage("preview"), stage("demo"), stage("restore"), stage("merge")];
const LINKED = [stage("ship"), sub("preview", "demo"), stage("demo"), sub("restore", "demo"), stage("merge")];

describe("номера и связка", () => {
  it("номер только у этапа верхнего уровня, под-этап без номера", () => {
    expect([...stageNumbers(LINKED)]).toEqual([["ship", 1], ["preview", null], ["demo", 2], ["restore", null], ["merge", 3]]);
  });

  it("связка владельца — его под-этапы в порядке списка, у под-этапа — владелец", () => {
    expect(subStagesOf(LINKED, "demo")).toEqual(["preview", "restore"]);
    expect(subStagesOf(LINKED, "ship")).toEqual([]);
    expect(ownerOf(LINKED, "restore")).toBe("demo");
    expect(ownerOf(LINKED, "demo")).toBeNull();
  });

  it("охват Выбора и Демонстрации — по номерам верхнего уровня", () => {
    const stages = [stage("select", { kind: "select" }), stage("task"), sub("preview", "demo"), stage("demo", { kind: "demo" }), sub("restore", "demo"), stage("merge")];
    expect(stageScope(stages, 0)).toEqual([2, 4]);
    expect(stageScope(stages, 3)).toEqual([1, 2]);
    expect(stageScope([stage("demo", { kind: "demo" })], 0)).toBeNull();
  });
});

describe("перетаскивание по четырём зонам строки", () => {
  const drop = (stages: readonly WorkStage[], drag: string, target: string, zone: DropZone) => ids(dropStage(stages, drag, target, zone));

  it("зона 2 делает этап под-этапом до цели, зона 3 — после", () => {
    const withPreview = dropStage(FLAT, "preview", "demo", 2)!;
    expect(ids(withPreview)).toEqual(["ship", "preview<demo", "demo", "restore", "merge"]);
    expect(drop(withPreview, "restore", "demo", 3)).toEqual(ids(LINKED));
  });

  it("зона 1 ставит над целью, зона 4 — под ней", () => {
    expect(drop(FLAT, "merge", "ship", 1)).toEqual(["merge", "ship", "preview", "demo", "restore"]);
    expect(drop(FLAT, "ship", "merge", 4)).toEqual(["preview", "demo", "restore", "merge", "ship"]);
  });

  it("крайняя зона у владельца со связкой с этой стороны встаёт в связку", () => {
    expect(drop(LINKED, "ship", "demo", 1)).toEqual(["preview<demo", "ship<demo", "demo", "restore<demo", "merge"]);
    expect(drop(LINKED, "merge", "demo", 4)).toEqual(["ship", "preview<demo", "demo", "merge<demo", "restore<demo"]);
  });

  it("цель — под-этап: этап встаёт в ту же связку рядом с ним", () => {
    expect(drop(LINKED, "ship", "restore", 1)).toEqual(["preview<demo", "demo", "ship<demo", "restore<demo", "merge"]);
    expect(drop(LINKED, "merge", "preview", 4)).toEqual(["ship", "preview<demo", "merge<demo", "demo", "restore<demo"]);
  });

  it("под-этап выводится наружу на границу между этапами", () => {
    expect(drop(LINKED, "restore", "merge", 4)).toEqual(["ship", "preview<demo", "demo", "merge", "restore"]);
  });

  it("владелец едет со связкой, но в чужую связку не встаёт", () => {
    expect(drop(LINKED, "demo", "ship", 1)).toEqual(["preview<demo", "demo", "restore<demo", "ship", "merge"]);
    expect(dropStage(LINKED, "demo", "merge", 2)).toBeNull();
    expect(dropStage([...LINKED, sub("tail", "merge")], "demo", "merge", 4)).toBeNull();
  });

  it("на себя и на свой под-этап — нельзя", () => {
    expect(dropStage(LINKED, "demo", "demo", 2)).toBeNull();
    expect(dropStage(LINKED, "demo", "restore", 1)).toBeNull();
  });
});

describe("одна галочка", () => {
  it("владелец меняет всю связку, снятый под-этап — только себя, возвращённый — себя и владельца", () => {
    expect(runCascade(LINKED, "demo", false)).toEqual(["demo", "preview", "restore"]);
    expect(runCascade(LINKED, "demo", true)).toEqual(["demo", "preview", "restore"]);
    expect(runCascade(LINKED, "restore", false)).toEqual(["restore"]);
    expect(runCascade(LINKED, "restore", true)).toEqual(["restore", "demo"]);
    expect(runCascade(LINKED, "ship", false)).toEqual(["ship"]);
  });
});

describe("удаление этапа", () => {
  it("удалённый владелец оставляет под-этапы этапами на своих местах", () => {
    expect(ids(removeStage(LINKED, "demo"))).toEqual(["ship", "preview", "restore", "merge"]);
    expect(ids(removeStage(LINKED, "preview"))).toEqual(["ship", "demo", "restore<demo", "merge"]);
  });
});

// Случайный правильный flow: этапы верхнего уровня, у каждого — сколько-то под-этапов до и после.
const flowArb = fc
  .array(fc.tuple(fc.nat(2), fc.nat(2)), { minLength: 1, maxLength: 6 })
  .map((shape) =>
    shape.flatMap(([before, after], i) => [
      ...Array.from({ length: before }, (_, k) => sub(`b${i}-${k}`, `s${i}`)),
      stage(`s${i}`),
      ...Array.from({ length: after }, (_, k) => sub(`a${i}-${k}`, `s${i}`)),
    ]),
  );
const moveArb = flowArb.chain((stages) =>
  fc.record({ stages: fc.constant(stages), drag: fc.constantFrom(...stages.map((s) => s.id)), target: fc.constantFrom(...stages.map((s) => s.id)), zone: fc.constantFrom<DropZone>(1, 2, 3, 4) }),
);
const sorted = (stages: readonly WorkStage[]) => stages.map((s) => s.id).sort();

describe("свойства на случайных flow", () => {
  it("перетаскивание даёт либо отказ, либо правильный flow с тем же набором этапов", () => {
    fc.assert(
      fc.property(moveArb, ({ stages, drag, target, zone }) => {
        const next = dropStage(stages, drag, target, zone);
        return next === null || (valid(next) && JSON.stringify(sorted(next)) === JSON.stringify(sorted(stages)));
      }),
    );
  });

  it("удаление даёт правильный flow без удалённого этапа", () => {
    fc.assert(
      fc.property(flowArb.chain((stages) => fc.record({ stages: fc.constant(stages), id: fc.constantFrom(...stages.map((s) => s.id)) })), ({ stages, id }) => {
        const next = removeStage(stages, id);
        return valid(next) && next.length === stages.length - 1 && next.every((s) => s.id !== id);
      }),
    );
  });

  it("номера идут 1…N без пропусков по этапам верхнего уровня", () => {
    fc.assert(
      fc.property(flowArb, (stages) => {
        const numbers = [...stageNumbers(stages).values()].filter((n) => n !== null);
        return JSON.stringify(numbers) === JSON.stringify(Array.from({ length: numbers.length }, (_, i) => i + 1)) && numbers.length === stages.filter((s) => s.parent === undefined).length;
      }),
    );
  });
});
