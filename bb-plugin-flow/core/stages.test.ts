// @vitest-environment node
import { describe, expect, it } from "vitest";

import { STAGES, add, dev2, planner, report, stage, stagedBrief } from "./stages-fixtures";
import { initialStageChoice, reportIssues, stageAdd, stageCarryOf, stageInstructions, stageItems, stagePhase } from "./stages";

const all = () => [report("task"), report("spec"), report("plan")];

describe("отчёт агента против настроек", () => {
  it("полный отчёт в порядке настроек проходит", () => {
    expect(reportIssues(STAGES, all())).toEqual([]);
  });

  it("пропущенный, лишний и переставленный этап — ошибка со списком этапов настроек", () => {
    for (const reports of [all().slice(0, 2), [...all(), report("deploy")], [report("spec"), report("task"), report("plan")]]) {
      const issues = reportIssues(STAGES, reports).join("\n");
      expect(issues).toContain("task, spec, plan");
    }
  });

  it("исполнитель не из этапа и добавка по чужому исполнителю названы", () => {
    const issues = reportIssues(STAGES, [report("task", { executor: "agent:planner" }), report("spec"), report("plan", { adds: { "agent:ghost": add(1, 2, 0) } })]).join("\n");
    expect(issues).toContain("agent:planner");
    expect(issues).toContain("agent:ghost");
  });

  it("без отчёта ошибок нет: бриф может обойтись без этапов", () => {
    expect(reportIssues(STAGES, undefined)).toEqual([]);
  });

  it("этапы при пустых настройках — ошибка", () => {
    expect(reportIssues([], all()).length).toBeGreaterThan(0);
  });
});

describe("этап в брифе", () => {
  it("этапы идут в порядке снимка настроек со своими отчётами", () => {
    const items = stageItems(stagedBrief([report("plan"), report("task"), report("spec")]));
    expect(items.map((i) => i.stage.id)).toEqual(["task", "spec", "plan"]);
    expect(items.map((i) => i.report?.id)).toEqual(["task", "spec", "plan"]);
  });

  it("фаза — из отчёта; этап без отчёта не сделан", () => {
    const brief = stagedBrief([report("task", { state: "done", results: [{ label: "BBPL-1", target: "BBPL-1.md" }] }), report("spec", { state: "review", results: [{ label: "s.md", target: "s.md" }] })]);
    expect(stageItems(brief).map(stagePhase)).toEqual(["done", "review", "todo"]);
  });

  it("перенесённый исполнитель, которого в этапе больше нет, не встаёт", () => {
    const brief = { ...stagedBrief([report("task"), report("spec"), report("plan")]), carried: { "stage:plan:executor": ["agent:ghost"] } };
    expect(initialStageChoice(brief, stageItems(brief)[2]!).executor).toBe("self");
  });

  it("добавка этапа — своя плюс разница выбранного исполнителя", () => {
    const brief = stagedBrief([report("task"), report("spec"), report("plan", { add: add(4, 7, -1, 15), adds: { [planner.id]: add(2, 4, -1, 10) } })]);
    const plan = stageItems(brief)[2]!;
    expect(stageAdd(plan, "self")).toEqual(add(4, 7, -1, 15));
    expect(stageAdd(plan, planner.id)).toEqual(add(6, 11, -2, 25));
  });

});
