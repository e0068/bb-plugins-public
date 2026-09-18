// @vitest-environment node
import { describe, expect, it } from "vitest";

import { forecast } from "./budget";
import { stageAdd, stageItems } from "./stages";
import { STAGES, add, report, stage, stagedBrief } from "./stages-fixtures";
import type { DecisionAnswer, WorkStage } from "../shared/contract";

const builtin: WorkStage = { id: "ff", kind: "skill", skill: "", name: "FF to Main", executors: [], automation: { source: "flow", steps: [] } };
const external: WorkStage = { id: "merge", kind: "skill", skill: "", name: "Merge", executors: [], automation: { id: "a1", name: "Merge" } };

const brief = stagedBrief([report("task", { recommended: true, add: add(1, 2, 0, 5) }), report("ff", { recommended: true, add: add(0.4, 0.8, 1, 2) }), report("merge", { recommended: true, add: add(0.4, 0.8, 1, 2) })], {
  stages: { list: [stage("task", { skill: "task-flow", name: "Задача" }), builtin, external], minButtonWidth: 170 },
});

const answer: DecisionAnswer = { briefId: brief.id, answers: [], stages: [] };

const itemOf = (id: string) => stageItems(brief).find((i) => i.stage.id === id)!;

describe("этап-автоматизация ничего не стоит", () => {
  it("добавка автоматизации не берётся, даже когда агент её прислал", () => {
    expect(stageAdd(itemOf("ff"), "self")).toBeUndefined();
    expect(stageAdd(itemOf("merge"), "self")).toBeUndefined();
    expect(stageAdd(itemOf("task"), "self")).toEqual(add(1, 2, 0, 5));
  });

  it("деньги, риск и минуты автоматизаций не входят в прогноз и не дают своей строки разбивки", () => {
    const f = forecast(brief, answer, "ru");
    expect(f.target).toBe(1);
    expect(f.max).toBe(2);
    expect(f.risk).toBe(0);
    expect(f.minutes).toBe(5);
    expect(f.lines.map((l) => l.label)).toEqual(["Задача"]);
  });

  it("этап навыка со списком исполнителей считается по-прежнему", () => {
    const usual = stagedBrief([report("plan", { recommended: true, add: add(4, 7, -1, 15) })], { stages: { list: STAGES, minButtonWidth: 170 } });
    expect(forecast(usual, answer, "ru").target).toBe(4);
  });
});
