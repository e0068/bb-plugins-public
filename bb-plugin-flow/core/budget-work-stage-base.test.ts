// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief, StageAnswer } from "../shared/contract";
import { forecast, stagePlans } from "./budget";
import { SELF, stageItems, stageSurcharge } from "./stages";
import { add, planner, report, stagedBrief } from "./stages-fixtures";

/** Бриф со скриншота владельца в SHA-82: база — пункты Definition of Done, реализация — этап с долей 100%. */
const reports = [
  report("task", { recommended: true, share: { percent: 10, risk: 0 } }),
  report("spec", { recommended: true, share: { percent: 20, risk: -1 } }),
  report("plan", { recommended: true, share: { percent: 100, risk: 2 }, factors: { [planner.id]: { factor: 1.5, risk: -1 } } }),
];
const brief: DecisionBrief = stagedBrief(reports, {
  scope: "- база",
  setup: { stages: reports, criteria: [{ text: "Тесты зелёные", add: add(4, 6, 2, 20) }, { text: "Дифф только в test/", add: add(2, 3, 1, 10) }] },
});

const run = (executor: string): DecisionAnswer => ({ briefId: brief.id, answers: [], stages: [{ id: "plan", run: true, executor, review: true } satisfies StageAnswer] });
const lineOf = (answer: DecisionAnswer, stage: string) => forecast(brief, answer).lines.find((l) => l.stage === stage);
const planItem = () => stageItems(brief).find((i) => i.stage.id === "plan")!;

describe("реализация агентом — база, а не надбавка", () => {
  it("этап работы у Main Agent ничего не прибавляет: ни денег, ни минут, ни риска", () => {
    expect(lineOf(run(SELF), "plan")).toMatchObject({ target: 0, max: 0, minutes: 0, risk: 0 });
  });

  it("итог — пункты Definition of Done плюс надбавки остальных этапов, риск — из пунктов", () => {
    const f = forecast(brief, run(SELF));
    expect(f.lines.filter((l) => l.criterion !== undefined).map((l) => l.target)).toEqual([4, 2]);
    expect(f).toMatchObject({ target: 7.8, max: 11.7, minutes: 39, risk: 2 });
  });

  it("другой исполнитель реализации прибавляет только разницу против Main Agent", () => {
    expect(lineOf(run(planner.id), "plan")).toMatchObject({ target: 3, max: 4.5, minutes: 15, risk: -1 });
    expect(forecast(brief, run(planner.id))).toMatchObject({ target: 10.8, max: 16.2, minutes: 54, risk: 1 });
  });

  it("строка исполнителя в списке этапа показывает ту же разницу", () => {
    const scope = add(6, 9, 3, 30);
    expect(stageSurcharge(planItem(), SELF, scope)).toMatchObject({ target: 0, max: 0, risk: 0, minutes: 0 });
    expect(stageSurcharge(planItem(), planner.id, scope)).toMatchObject({ target: 3, max: 4.5, risk: -1, minutes: 15 });
  });

  it("план этапа работы в контейнере прогона — по-прежнему весь объём", () => {
    expect(stagePlans(brief, run(SELF)).plan).toEqual({ minutes: 30, target: 6 });
  });
});
