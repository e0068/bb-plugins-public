// @vitest-environment node
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionAnswer, StageAnswer } from "../shared/contract";
import { answerMessageText, deviationTotal, deviations, openQuestions } from "./answer-message";
import { STAGES, planner, report, stagedBrief } from "./stages-fixtures";

const results = [{ label: "spec.md", target: "docs/specs/spec.md" }];
const demo = builtinStage("demo", STAGES.map((s) => s.id));

/** Этапы со старым состоянием review — бриф, записанный до Демонстрации. */
const brief = stagedBrief(
  [report("task", { state: "done", results: [{ label: "BBPL-1", target: "docs/tasks/BBPL-1.md" }] }), report("spec", { state: "review", results }), report("plan", { recommended: true }), report("demo", { recommended: true })],
  { stages: { list: [...STAGES, { ...demo, name: "Демонстрация" }], minButtonWidth: 170 } },
);

const answer = (stages: StageAnswer[]): DecisionAnswer => ({ briefId: brief.id, answers: [], stages });

const planRun: StageAnswer = { id: "plan", run: true, executor: "self" };
const demoRun: StageAnswer = { id: "demo", run: true, executor: "self" };

describe("ответ по этапам без приёмки", () => {
  it("этап, ждавший приёмки в старом брифе, вопроса не открывает", () => {
    expect(openQuestions(brief, answer([planRun, demoRun]))).toEqual([]);
  });

  it("выбор по этапу, которого нет в брифе, или исполнитель не из этапа — не ложатся на бриф", () => {
    expect(openQuestions(brief, answer([planRun, { id: "ghost", run: true, executor: "self" }]))).toContain("ghost");
    expect(openQuestions(brief, answer([{ ...planRun, executor: "agent:ghost" }]))).toContain("setup.stage.plan");
  });

  it("реплика называет этапы: сделан со ссылкой — и ждавший приёмки тоже, в прогон с исполнителем; Review by User нет", () => {
    const text = answerMessageText(brief, answer([{ ...planRun, executor: planner.id }, demoRun]));
    expect(text).toContain("Задача — сделан");
    expect(text).toContain("BBPL-1");
    expect(text).toContain("Спецификация — сделан: spec.md");
    expect(text).toMatch(/План — в прогон, исполняет planner/);
    expect(text).not.toMatch(/Review by User|приёмк/);
  });

  it("«Дальше» перечисляет прогон и остановки на Демонстрациях из прогона", () => {
    const next = (stages: StageAnswer[]) => answerMessageText(brief, answer(stages)).split("\n").find((l) => l.startsWith("Дальше")) ?? "";
    expect(next([planRun, demoRun])).toMatch(/План, Демонстрация/);
    expect(next([planRun, demoRun])).toMatch(/на этапах Демонстрация остановись и пришли демонстрацию/);
    expect(next([planRun, { ...demoRun, run: false, picked: ["run"] }])).toContain("демонстраций в прогоне нет");
  });

  it("расхождение с рекомендацией названо; этапы входят в знаменатель расхождений", () => {
    const text = answerMessageText(brief, answer([{ ...planRun, run: false, picked: ["run"] }, demoRun]));
    expect(text).toMatch(/План — не в прогон \(рекомендовал в прогон, исполняет Сам/);
    expect(deviationTotal(brief)).toBe(4);
    expect(deviations(brief, answer([planRun, demoRun]))).toBe(0);
    expect(deviations(brief, answer([{ ...planRun, executor: planner.id }, demoRun]))).toBe(1);
  });
});
