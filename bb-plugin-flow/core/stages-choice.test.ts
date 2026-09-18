// @vitest-environment node
import { describe, expect, it } from "vitest";

import { dev2, planner, report, stage, stagedBrief } from "./stages-fixtures";
import { initialStageChoice, isStageCarryKey, stageCarryOf, stageInstructions, stageItems } from "./stages";

const all = () => [report("task"), report("spec"), report("plan")];

describe("выбор по этапу без review", () => {
  it("выбор при открытии — рекомендация агента; перенесённый исполнитель владельца встаёт поверх", () => {
    const brief = stagedBrief([report("task"), report("spec"), report("plan", { recommended: true, executor: "agent:planner" })]);
    const plan = stageItems(brief)[2]!;
    expect(initialStageChoice(brief, plan)).toEqual({ run: true, executor: "agent:planner" });
    expect(initialStageChoice({ ...brief, carried: { "stage:plan:executor": [dev2.id], "stage:plan:review": ["off"] } }, plan)).toEqual({ run: true, executor: dev2.id });
  });

  it("перенос — только исполнитель, которого владелец выбрал сам; ключа review нет", () => {
    const brief = stagedBrief(all());
    const answer = { briefId: brief.id, answers: [], stages: [
      { id: "plan", run: true, executor: planner.id, picked: ["executor" as const] },
      { id: "spec", run: false, executor: "self", picked: ["run" as const] },
    ] };
    expect(stageCarryOf(brief, answer)).toEqual({ "stage:plan:executor": [planner.id] });
    expect(isStageCarryKey("stage:plan:review", ["plan"])).toBe(false);
    expect(isStageCarryKey("stage:plan:executor", ["plan"])).toBe(true);
  });

  it("инструкции агенту называют id, названия и исполнителей этапов навыков", () => {
    const text = stageInstructions([stage("plan", { name: "План", executors: [planner] })]);
    for (const word of ["setup.stages", "plan", "План", "agent:planner"]) expect(text).toContain(word);
    expect(text).not.toMatch(/review/i);
    expect(stageInstructions([])).toBeNull();
  });
});
