// @vitest-environment node
import { describe, expect, it } from "vitest";

import { automationStage, automationStageId, stageKindOf } from "../lib/stage-constants";

describe("этап-автоматизация среди видов этапов", () => {
  it("этап-автоматизация — этап навыка без навыка, Review и исполнителей, id выводится из автоматизации", () => {
    const stage = automationStage({ id: "click-pr", name: "Pull Request" });
    expect(stage).toEqual({ id: automationStageId("click-pr"), kind: "skill", skill: "", name: "Pull Request", executors: [], automation: { id: "click-pr", name: "Pull Request" } });
    expect(stageKindOf(stage)).toBe("skill");
  });
});
