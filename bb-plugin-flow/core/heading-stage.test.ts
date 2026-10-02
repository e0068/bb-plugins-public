// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { WorkStage } from "../shared/contract";
import { stageInstructions } from "./stages";
import { isHeadingStage } from "./sub-stages";

const stage = (id: string, patch: Partial<WorkStage> = {}): WorkStage => ({ id, kind: "skill", skill: id, name: id, executors: [], ...patch });
const heading = stage("review", { skill: "", name: "Ревью" });
const FLOW = [heading, stage("lint", { parent: "review" }), stage("tests", { parent: "review" }), stage("merge")];

describe("этап-заголовок — этап без навыка и исполнения, работу которого несут его под-этапы", () => {
  it("этап без навыка, исполнителей и шагов, но с под-этапами — заголовок", () => {
    expect(isHeadingStage(FLOW, heading)).toBe(true);
  });

  it("с навыком, исполнителем, шагами или без под-этапов — обычный этап", () => {
    const withSkill = { ...heading, skill: "review" };
    const withExecutor = { ...heading, executors: [{ id: "agent:reviewer", kind: "agent" as const, name: "reviewer" }] };
    const withSteps = { ...heading, automation: { source: "flow" as const, steps: [] } };
    expect(isHeadingStage(FLOW.map((s) => (s.id === "review" ? withSkill : s)), withSkill)).toBe(false);
    expect(isHeadingStage(FLOW.map((s) => (s.id === "review" ? withExecutor : s)), withExecutor)).toBe(false);
    expect(isHeadingStage(FLOW.map((s) => (s.id === "review" ? withSteps : s)), withSteps)).toBe(false);
    expect(isHeadingStage([heading, stage("merge")], heading)).toBe(false);
  });

  it("встроенный этап без своего навыка заголовком не бывает: его навык — навык вида", () => {
    const questions: WorkStage = { id: "questions", kind: "questions", skill: "", name: "Questions", executors: [] };
    expect(isHeadingStage([questions, stage("criteria", { parent: "questions" })], questions)).toBe(false);
  });

  it("инструкции велят заголовку не исполняться: работа в под-этапах, сам он отмечается сделанным без результатов", () => {
    const line = (stageInstructions(FLOW) ?? "").split("\n")[1]!;
    expect(line).toMatch(/^1\. review "Ревью" — heading: no work of its own/);
    expect(line).toMatch(/sub-stages/);
    expect(line).not.toMatch(/you execute it yourself/);
  });
});
