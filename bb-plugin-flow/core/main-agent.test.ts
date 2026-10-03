// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { StageExecutor, StageReport, WorkStage } from "../shared/contract";
import { hasMainAgent, withExecutor, withMainAgent, withoutMainAgent } from "./stage-execution";
import { recommendedStageChoice, reportIssues, stageExecutorIds, stageInstructions } from "./stages";

const reviewer: StageExecutor = { id: "agent:reviewer", kind: "agent", name: "reviewer" };
const skillStage = (over: Partial<WorkStage> = {}): WorkStage => ({ id: "review", kind: "skill", skill: "code-review", name: "Review", executors: [], ...over });
const report = (over: Partial<StageReport> = {}): StageReport => ({ id: "review", state: "todo", recommended: true, executor: "self", ...over });

describe("Main Agent — агент треда как исполнитель этапа", () => {
  it("стоит у этапа по умолчанию, с исполнителями и без", () => {
    expect(hasMainAgent(skillStage())).toBe(true);
    expect(hasMainAgent(skillStage({ executors: [reviewer] }))).toBe(true);
  });

  it("снимается, когда у этапа есть другой исполнитель, и возвращается", () => {
    const without = withoutMainAgent(skillStage({ executors: [reviewer] }));
    expect(hasMainAgent(without)).toBe(false);
    expect(hasMainAgent(withMainAgent(without))).toBe(true);
    expect(withMainAgent(without)).toEqual(skillStage({ executors: [reviewer] }));
  });

  it("единственного исполнителя не снять: этап без исполнителей ведёт агент треда", () => {
    expect(withoutMainAgent(skillStage())).toEqual(skillStage());
    expect(hasMainAgent(skillStage({ mainAgent: false }))).toBe(true);
  });

  it("снятый последний исполнитель возвращает Main Agent", () => {
    const stage = withExecutor(withoutMainAgent(skillStage({ executors: [reviewer] })), reviewer, "Review");
    expect(stage).toEqual(skillStage());
  });
});

describe("Main Agent в инструкциях и брифе", () => {
  it("снятый Main Agent пропадает из исполнителей этапа в инструкциях агенту", () => {
    expect(stageInstructions([skillStage({ executors: [reviewer] })])).toMatch(/executors: self, agent:reviewer$/m);
    expect(stageInstructions([skillStage({ executors: [reviewer], mainAgent: false })])).toMatch(/executors: agent:reviewer$/m);
  });

  it("исполнители этапа на выбор — Main Agent, если не снят, и остальные", () => {
    expect(stageExecutorIds(skillStage({ executors: [reviewer] }))).toEqual(["self", "agent:reviewer"]);
    expect(stageExecutorIds(skillStage({ executors: [reviewer], mainAgent: false }))).toEqual(["agent:reviewer"]);
  });

  it("бриф с исполнителем self на этапе без Main Agent отклоняется", () => {
    const stages = [skillStage({ executors: [reviewer], mainAgent: false })];
    expect(reportIssues(stages, [report()]).join("\n")).toMatch(/executor self is not one of the stage's — agent:reviewer/);
    expect(reportIssues(stages, [report({ executor: "agent:reviewer" })])).toEqual([]);
  });

  it("без Main Agent выбор исполнителя по умолчанию — первый исполнитель этапа", () => {
    const stage = skillStage({ executors: [reviewer], mainAgent: false });
    expect(recommendedStageChoice({ stage, report: undefined }).executor).toBe("agent:reviewer");
  });
});
