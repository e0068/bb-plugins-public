// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, StageAnswer } from "../shared/contract";
import { stagePlans } from "./budget";
import { add, planner, report, stagedBrief } from "./stages-fixtures";

const brief = stagedBrief([
  report("task", { state: "done", add: add(1, 2, -1, 5) }),
  report("plan", { recommended: true, add: add(4, 7, -1, 15), adds: { [planner.id]: add(2, 4, -1, 10) } }),
  report("spec", { recommended: true, add: add(5, 9, -1) }),
]);

const answer = (stages: StageAnswer[]): DecisionAnswer => ({ briefId: brief.id, answers: [], stages });

describe("план этапов прогона", () => {
  it("этап в прогоне получает минуты и доллары своей добавки вместе с разницей исполнителя", () => {
    expect(stagePlans(brief, answer([{ id: "plan", run: true, executor: planner.id, review: true }]))).toMatchObject({ plan: { minutes: 25, target: 6 } });
  });

  it("добавка без минут даёт план без минут", () => {
    expect(stagePlans(brief, answer([])).spec).toEqual({ minutes: null, target: 5 });
  });

  it("сделанный этап и этап вне прогона плана не получают", () => {
    const plans = stagePlans(brief, answer([{ id: "plan", run: false, executor: "self", review: true }]));
    expect(Object.keys(plans)).toEqual(["spec"]);
  });
});
