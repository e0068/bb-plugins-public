// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { actionStage, BUILTIN_KINDS, isDefaultName, STAGE_KINDS, stageKindOf, stageSkillOf } from "./stage-constants";

describe("вид этапа Action", () => {
  it("вид этапа — навык, четыре встроенных или Action", () => {
    expect(STAGE_KINDS).toEqual(["skill", "questions", "criteria", "select", "demo", "action"]);
    expect(BUILTIN_KINDS).toEqual(["questions", "criteria", "select", "demo"]);
  });

  it("у этапа Action нет навыка", () => {
    const stage = actionStage([]);
    expect(stageKindOf(stage)).toBe("action");
    expect(stageSkillOf(stage)).toBe("");
    expect(stageSkillOf({ ...stage, skill: "publish" })).toBe("publish");
  });

  it("имя Action — имя по умолчанию, своё имя владельца — нет", () => {
    expect(isDefaultName(actionStage([]))).toBe(true);
    expect(isDefaultName({ ...actionStage([]), name: "Опубликовать" })).toBe(false);
  });

  it("заготовка Action пуста по шагам и по исполнителям", () => {
    expect(actionStage([])).toEqual({ id: "flow-action", kind: "action", skill: "", name: "Action", executors: [], automation: { source: "flow", steps: [] } });
  });

  it("id заготовки Action не совпадает ни с одним из занятых", () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(fc.constantFrom("flow-action", "flow-action-2", "flow-automation"), fc.string()), { maxLength: 12 }), (taken) => {
        expect(taken).not.toContain(actionStage(taken).id);
      }),
    );
  });
});
