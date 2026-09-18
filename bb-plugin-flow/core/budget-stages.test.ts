// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, StageAnswer } from "../shared/contract";
import { forecast, hasForecast, plannedMinutes } from "./budget";
import { add, planner, report, stagedBrief } from "./stages-fixtures";

const results = [{ label: "s.md", target: "s.md" }];

const brief = stagedBrief(
  [
    report("task", { state: "done", results, add: add(1, 2, -1, 5) }),
    report("spec", { state: "review", results, add: add(5, 9, -1, 20) }),
    report("plan", { recommended: true, add: add(4, 7, -1, 15), adds: { [planner.id]: add(2, 4, -1, 10) } }),
  ],
  { planning: { minutes: 3, cost: 1.1 } },
);

const answer = (stages: StageAnswer[]): DecisionAnswer => ({ briefId: brief.id, answers: [], stages });

describe("бюджет по этапам", () => {
  it("этап в прогоне даёт строку «название · исполнитель» с суммой своей добавки и разницы исполнителя", () => {
    const f = forecast(brief, answer([{ id: "plan", run: true, executor: planner.id, review: true }]));
    const line = f.lines.find((l) => l.label === "План");
    expect(line).toMatchObject({ minutes: 25, risk: -2, target: 6, max: 11 });
    expect(line?.note).toContain("planner");
  });

  it("сделанный, ждущий приёмки и не взятый в прогон этапы строк не дают", () => {
    const f = forecast(brief, answer([{ id: "plan", run: false, executor: "self", review: true }]));
    expect(f.lines.map((l) => l.label)).toEqual(["Планирование в треде"]);
  });

  it("без выбора в ответе этап считается по рекомендации", () => {
    expect(forecast(brief, answer([])).lines.map((l) => l.label)).toContain("План");
  });

  it("добавки этапов делают прогноз", () => {
    expect(hasForecast(stagedBrief([report("plan", { add: add(1, 1, 0) })]))).toBe(true);
    expect(hasForecast(stagedBrief([report("plan")]))).toBe(false);
  });
});

describe("уже потраченное не путается с этапом", () => {
  it("этап с названием «Планирование в треде» — запланированная работа", () => {
    const named = stagedBrief([report("plan", { recommended: true, add: add(1, 2, 0, 30) })]);
    const renamed = { ...named, stages: { list: named.stages!.list.map((s) => (s.id === "plan" ? { ...s, name: "Планирование в треде" } : s)), minButtonWidth: 170 } };
    expect(plannedMinutes(forecast(renamed, { briefId: renamed.id, answers: [] }))).toBe(30);
  });

  it("снимок ответа, записанный до пометки, узнаёт планирование по первой строке", () => {
    const old = { lines: [{ label: "Планирование в треде", note: "42 мин", minutes: 42, risk: 0, target: 1, max: 1 }, { label: "Пункт 1", note: "…", minutes: 15, risk: 0, target: 1, max: 1 }] };
    expect(plannedMinutes(old)).toBe(15);
  });
});
