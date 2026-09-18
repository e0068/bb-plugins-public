// @vitest-environment node
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import { FLOW_RULE, reportIssues, stageInstructions, stageLabel } from "./stages";
import { report, stage } from "./stages-fixtures";

const names = { questions: "Вопросы", criteria: "Критерии", select: "Выбор этапов", demo: "Демонстрация" };

describe("встроенные виды этапов", () => {
  it("встроенный этап подписан по виду, в том числе прежний Уточнение, свой — своим именем", () => {
    expect(stageLabel(builtinStage("demo", []), names)).toBe("Демонстрация");
    expect(stageLabel({ ...builtinStage("select", ["select"]) }, names)).toBe("Выбор этапов");
    expect(stageLabel({ id: "clarify", name: "Clarification" }, names)).toBe("Вопросы");
    expect(stageLabel(stage("spec", { name: "Спека" }), names)).toBe("Спека");
  });

  it("правило flow велит говорить с владельцем только этапами, а вне их — уточнением", () => {
    expect(FLOW_RULE).toMatch(/only through/);
    expect(FLOW_RULE).toMatch(/clarify/);
  });

  it("встроенный этап сделан без ссылок, этап навыка — только со ссылками", () => {
    const stages = [builtinStage("questions", []), stage("spec")];
    expect(reportIssues(stages, [report("questions", { state: "done" }), report("spec")])).toEqual([]);
    expect(reportIssues(stages, [report("questions"), report("spec", { state: "done" })]).join()).toMatch(/spec.*results/);
    expect(reportIssues(stages, [report("questions"), report("spec", { state: "done", results: [{ label: "spec.md", target: "spec.md" }] })])).toEqual([]);
  });

  it("порядок отчёта — порядок таблицы, с повторяющимися видами", () => {
    const stages = [builtinStage("select", []), stage("spec"), builtinStage("select", ["select"])];
    expect(reportIssues(stages, [report("select"), report("spec"), report("select-2")])).toEqual([]);
    expect(reportIssues(stages, [report("select-2"), report("spec"), report("select")])).not.toEqual([]);
  });
});
