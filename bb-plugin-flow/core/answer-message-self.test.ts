// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, StageAnswer } from "../shared/contract";
import { answerMessageText } from "./answer-message";
import { planner, report, stagedBrief } from "./stages-fixtures";

const brief = stagedBrief([report("task", { recommended: true }), report("spec", { recommended: true }), report("plan", { recommended: true })]);

const answer = (stages: StageAnswer[]): DecisionAnswer => ({ briefId: brief.id, answers: [], stages });

const next = (stages: StageAnswer[], locale?: "en") =>
  answerMessageText(brief, answer(stages), locale).split("\n").find((l) => l.startsWith("Дальше") || l.startsWith("Next")) ?? "";

describe("исполнитель «Сам» в ответе на бриф запрещает субагентов и workflow", () => {
  it("этапы прогона на «Сам» названы в «Дальше» вместе с запретом субагентов и workflow", () => {
    const line = next([{ id: "task", run: true, executor: "self" }, { id: "spec", run: true, executor: "self" }, { id: "plan", run: true, executor: planner.id }]);
    expect(line).toMatch(/Этапы Задача, Спецификация исполняешь сам: без субагентов и workflow/);
  });

  it("этап, отданный агенту, и этап не в прогоне под запрет не попадают", () => {
    const line = next([{ id: "task", run: false, executor: "self" }, { id: "spec", run: true, executor: "self" }, { id: "plan", run: true, executor: planner.id }]);
    expect(line).toMatch(/Этапы Спецификация исполняешь сам/);
    expect(line).not.toMatch(/Задача исполняешь|План исполняешь|План,? .*исполняешь сам/);
  });

  it("прогон без этапов на «Сам» запрета не несёт", () => {
    expect(next([{ id: "task", run: false, executor: "self" }, { id: "spec", run: false, executor: "self" }, { id: "plan", run: true, executor: planner.id }])).not.toMatch(/без субагентов/);
  });

  it("по-английски запрет тот же", () => {
    const stages = [{ id: "task", run: false, executor: "self" }, { id: "spec", run: true, executor: "self" }, { id: "plan", run: true, executor: planner.id }];
    expect(next(stages, "en")).toMatch(/Stages Спецификация you run yourself: no subagents and no workflows/);
  });
});
