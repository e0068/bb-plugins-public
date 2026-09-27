// @vitest-environment node
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionAnswer, StageAnswer } from "../shared/contract";
import { answerMessageText } from "./answer-message";
import { STAGES, planner, report, stage, stagedBrief } from "./stages-fixtures";

const merge = stage("merge", { name: "Commit, FF to Main, PR", automation: { source: "flow", steps: [] } });

const brief = stagedBrief([report("task", { recommended: true }), report("spec"), report("plan", { recommended: true, executor: planner.id }), report("merge", { recommended: true })], {
  stages: { list: [...STAGES, merge], minButtonWidth: 170 },
});

const answer = (stages: StageAnswer[]): DecisionAnswer => ({ briefId: brief.id, answers: [], stages });
const lines = (stages: StageAnswer[], locale?: "en") => answerMessageText(brief, answer(stages), locale).split("\n");

const run: StageAnswer[] = [
  { id: "task", run: true, executor: "self" },
  { id: "spec", run: false, executor: "self" },
  { id: "plan", run: true, executor: planner.id },
  { id: "merge", run: true, executor: "self" },
];

describe("строка прогона в ответе на бриф", () => {
  it("этапы прогона по порядку через стрелку; исполнитель назван только у отданных не себе, у автоматизации его нет", () => {
    expect(lines(run)).toContain("Прогон: Задача → План (planner · opus) → Commit, FF to Main, PR.");
  });

  it("правил для агента в реплике нет: ни «сам — без субагентов», ни «без новых брифов»", () => {
    expect(lines(run).join("\n")).not.toMatch(/субагент|без новых брифов|исполняешь сам|Дальше/);
  });

  it("этап, взятый сверх рекомендации, назван добавленным", () => {
    expect(lines([run[0]!, { ...run[1]!, run: true, picked: ["run"] }, run[2]!, run[3]!])).toContain("Не по рекомендации: Спецификация — добавлен.");
  });

  it("по-английски та же строка", () => {
    const en = lines([run[0]!, { ...run[1]!, run: true, picked: ["run"] }, run[2]!, run[3]!], "en");
    expect(en).toContain("Run: Задача → Спецификация → План (planner · opus) → Commit, FF to Main, PR.");
    expect(en).toContain("Off the recommendation: Спецификация — added.");
  });

  it("Демонстрация в прогоне — обычный этап строки, без отдельного правила об остановке", () => {
    const withDemo = stagedBrief([report("task", { recommended: true }), report("demo", { recommended: true })], {
      stages: { list: [STAGES[0]!, { ...builtinStage("demo", ["task"]), name: "Демонстрация" }], minButtonWidth: 170 },
    });
    const text = answerMessageText(withDemo, { briefId: withDemo.id, answers: [], stages: [{ id: "task", run: true, executor: "self" }, { id: "demo", run: true, executor: "self" }] });
    expect(text.split("\n")).toContain("Прогон: Задача → Демонстрация.");
    expect(text).not.toMatch(/остановись/);
  });
});
