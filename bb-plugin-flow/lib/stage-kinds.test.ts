// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { BUILTIN_KINDS, builtinStage, STAGE_KINDS, stageKindOf } from "./stage-constants";

describe("виды этапов", () => {
  it("вид этапа — навык или один из четырёх встроенных", () => {
    expect(STAGE_KINDS).toEqual(["skill", "questions", "criteria", "select", "demo"]);
    expect(BUILTIN_KINDS).toEqual(["questions", "criteria", "select", "demo"]);
  });

  it("вид берётся из поля, а у записи без поля — из прежних id Уточнения и Критериев", () => {
    expect(stageKindOf({ id: "x", kind: "demo" })).toBe("demo");
    expect(stageKindOf({ id: "clarify" })).toBe("questions");
    expect(stageKindOf({ id: "criteria" })).toBe("criteria");
    expect(stageKindOf({ id: "task" })).toBe("skill");
  });

  it("встроенный этап — без навыка, исполнителей и Review, id по виду", () => {
    expect(builtinStage("demo", [])).toEqual({ id: "demo", kind: "demo", skill: "", name: "Demonstration", executors: [] });
    expect(builtinStage("select", []).name).toBe("Stage selection");
    expect(builtinStage("questions", []).name).toBe("Questions");
  });

  it("занятый id вида получает номер", () => {
    expect(builtinStage("demo", ["demo"]).id).toBe("demo-2");
    expect(builtinStage("demo", ["demo", "demo-2"]).id).toBe("demo-3");
  });

  it("id встроенного этапа не совпадает ни с одним из занятых", () => {
    fc.assert(
      fc.property(fc.constantFrom(...BUILTIN_KINDS), fc.array(fc.oneof(fc.constantFrom("demo", "demo-2", "select", "questions-3"), fc.string()), { maxLength: 12 }), (kind, taken) => {
        expect(taken).not.toContain(builtinStage(kind, taken).id);
      }),
    );
  });
});
