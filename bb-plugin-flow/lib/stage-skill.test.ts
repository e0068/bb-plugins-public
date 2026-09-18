// @vitest-environment node
import { describe, expect, it } from "vitest";

import { BUILTIN_SKILLS, builtinStage, ROOT_SKILL, stageSkillOf } from "./stage-constants";

describe("навык этапа", () => {
  it("у каждого встроенного вида свой навык, корневой навык — flow", () => {
    expect(BUILTIN_SKILLS).toEqual({ questions: "flow-questions", criteria: "flow-criteria", select: "flow-stage-selection", demo: "flow-demo" });
    expect(ROOT_SKILL).toBe("flow");
  });

  it("встроенный этап без своего навыка идёт по навыку вида", () => {
    expect(stageSkillOf(builtinStage("demo", []))).toBe("flow-demo");
    expect(stageSkillOf({ id: "clarify", skill: "" })).toBe("flow-questions");
  });

  it("свой навык встроенного этапа и навык этапа-навыка берутся как есть", () => {
    expect(stageSkillOf({ ...builtinStage("questions", []), skill: "my-questions" })).toBe("my-questions");
    expect(stageSkillOf({ id: "task", kind: "skill", skill: "task-flow" })).toBe("task-flow");
    expect(stageSkillOf({ id: "task", kind: "skill", skill: "" })).toBe("");
  });
});
