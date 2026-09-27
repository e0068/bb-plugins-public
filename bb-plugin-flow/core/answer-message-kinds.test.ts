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

  it("реплика не перечисляет сделанные этапы: только строка прогона по порядку, исполнитель — у отданных не себе", () => {
    const lines = answerMessageText(brief, answer([{ ...planRun, executor: planner.id }, demoRun])).split("\n");
    expect(lines).toContain("Прогон: План (planner · opus) → Демонстрация.");
    expect(lines.join("\n")).not.toMatch(/BBPL-1|spec\.md|Этапы работ|Дальше|Review by User|приёмк/);
  });

  it("прогон без этапов — «Прогон пуст.»", () => {
    expect(answerMessageText(brief, answer([{ ...planRun, run: false, picked: ["run"] }, { ...demoRun, run: false, picked: ["run"] }])).split("\n")).toContain("Прогон пуст.");
  });

  it("расхождения с рекомендацией — одной строкой: снятый этап и другой исполнитель; совпадение строки не даёт", () => {
    const text = (stages: StageAnswer[]) => answerMessageText(brief, answer(stages)).split("\n");
    expect(text([{ ...planRun, run: false, picked: ["run"] }, demoRun])).toContain("Не по рекомендации: План — снят.");
    expect(text([{ ...planRun, executor: planner.id }, demoRun])).toContain("Не по рекомендации: План — planner · opus вместо Сам.");
    expect(text([planRun, demoRun]).some((l) => l.startsWith("Не по рекомендации"))).toBe(false);
  });

  it("этапы входят в знаменатель расхождений", () => {
    expect(deviationTotal(brief)).toBe(4);
    expect(deviations(brief, answer([planRun, demoRun]))).toBe(0);
    expect(deviations(brief, answer([{ ...planRun, executor: planner.id }, demoRun]))).toBe(1);
  });
});
