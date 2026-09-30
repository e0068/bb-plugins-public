// @vitest-environment node
import { describe, expect, it } from "vitest";

import { ROOT_SKILL } from "../lib/stage-constants";
import type { FlowSettings, WorkStage } from "../shared/contract";
import { withoutLegacyStages } from "./legacy-stages";
import { stage } from "./stages-fixtures";

const builtin = (id: string, kind: WorkStage["kind"], name: string): WorkStage => ({ id, kind, skill: "", name, executors: [] });

/** Flow по умолчанию, который раздавала витрина до 8532ba0a: этапы-навыки на личных навыках владельца. */
const LEGACY_DEFAULT: WorkStage[] = [
  builtin("questions", "questions", "Questions"),
  builtin("criteria", "criteria", "Criteria"),
  builtin("select", "select", "Stage selection"),
  stage("task", { skill: "task-flow", name: "Task" }),
  stage("prototype", { skill: "prototype", name: "HTML prototype" }),
  builtin("demo", "demo", "Demonstration"),
  stage("spec", { skill: "spec", name: "Spec" }),
  stage("plan", { skill: "plan", name: "Plan" }),
  stage("implement", { skill: "code-standards-fp", name: "Implementation" }),
  stage("review", { skill: "code-review", name: "Review" }),
  stage("testing", { skill: "testing-tdd", name: "Testing" }),
  builtin("demo-2", "demo", "Demonstration"),
];

const OWNER_SKILLS = ["task-flow", "prototype", "spec", "plan", "code-standards-fp", "code-review", "testing-tdd"];
const own = stage("research", { skill: "deep-research", name: "Research" });

const settingsOf = (...flows: Array<{ id: string; stages: WorkStage[]; description?: string }>): FlowSettings => ({
  flows: flows.map((f) => ({ name: `Flow ${f.id}`, ...f })),
  minButtonWidth: 170,
  version: 2,
});

const ids = (settings: FlowSettings) => settings.flows.map((f) => f.stages.map((s) => s.id));

describe("этапы прежнего flow по умолчанию без навыка", () => {
  it("уходят из каждого flow, а встроенные этапы, названия, описания и свои этапы остаются", () => {
    const stored = settingsOf({ id: "default", stages: [...LEGACY_DEFAULT, own], description: "Всё подряд" }, { id: "flow-2", stages: LEGACY_DEFAULT });
    const healed = withoutLegacyStages(stored, [ROOT_SKILL, "deep-research"]);
    expect(ids(healed)).toEqual([
      ["questions", "criteria", "select", "demo", "demo-2", "research"],
      ["questions", "criteria", "select", "demo", "demo-2"],
    ]);
    expect(healed.flows.map((f) => [f.name, f.description])).toEqual([["Flow default", "Всё подряд"], ["Flow flow-2", undefined]]);
  });

  it("у владельца, у которого эти навыки есть, коллекция не меняется вовсе", () => {
    const stored = settingsOf({ id: "default", stages: LEGACY_DEFAULT });
    expect(withoutLegacyStages(stored, [ROOT_SKILL, ...OWNER_SKILLS])).toBe(stored);
  });

  it("уходят только те этапы прежнего набора, чьего навыка нет", () => {
    const stored = settingsOf({ id: "default", stages: LEGACY_DEFAULT });
    expect(ids(withoutLegacyStages(stored, [ROOT_SKILL, "spec", "plan"]))).toEqual([["questions", "criteria", "select", "demo", "spec", "plan", "demo-2"]]);
  });

  it("список навыков, в котором не видно навыка самого плагина, не прочитан — коллекция не меняется", () => {
    const stored = settingsOf({ id: "default", stages: LEGACY_DEFAULT });
    expect(withoutLegacyStages(stored, [])).toBe(stored);
    expect(withoutLegacyStages(stored, ["deep-research"])).toBe(stored);
  });

  it("этап с тем же навыком под другим id и этап с тем же id на другом навыке — не из прежнего набора и остаются", () => {
    const mine = [stage("spec-2", { skill: "spec" }), stage("review", { skill: "my-review" })];
    const stored = settingsOf({ id: "default", stages: mine });
    expect(withoutLegacyStages(stored, [ROOT_SKILL])).toBe(stored);
  });
});
