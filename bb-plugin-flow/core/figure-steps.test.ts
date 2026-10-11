// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { FlowSettings, WorkStage } from "../shared/contract";
import { withFigureSteps } from "./figure-steps";

const auto = (id: string, steps: string[]): WorkStage => ({ id, kind: "skill", skill: "", name: id, executors: [], automation: { source: "flow", steps: steps as never } });
const settingsOf = (...stages: WorkStage[]): FlowSettings => ({ flows: [{ id: "f", name: "F", stages }], minButtonWidth: 170 }) as FlowSettings;
const stepsOf = (s: FlowSettings) => s.flows[0]!.stages.map((stage) => (stage.automation && "source" in stage.automation ? stage.automation.steps : []));

describe("withFigureSteps", () => {
  it("план встаёт за переименованием треда, факт — перед «Задача → done»", () => {
    const settings = settingsOf(auto("rename", ["bb.rename-thread"]), auto("finalize", ["bb.tasks-done", "git.commit", "git.merge"]));
    expect(stepsOf(withFigureSteps(settings))).toEqual([["bb.rename-thread", "bb.tasks-plan"], ["bb.tasks-fact", "bb.tasks-done", "git.commit", "git.merge"]]);
  });

  it("flow без задачи и flow, где шаги уже стоят, остаются той же коллекцией", () => {
    const none = settingsOf(auto("pr", ["git.commit", "git.create-pr"]));
    expect(withFigureSteps(none)).toBe(none);
    const placed = withFigureSteps(settingsOf(auto("rename", ["bb.rename-thread"]), auto("finalize", ["bb.tasks-done"])));
    expect(withFigureSteps(placed)).toBe(placed);
  });
});
