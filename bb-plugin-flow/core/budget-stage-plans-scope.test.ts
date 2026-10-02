// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { stagePlans } from "./budget";
import { add, planner, report, stagedBrief } from "./stages-fixtures";

const reports = [
  report("spec", { recommended: true, share: { percent: 20, risk: -1 } }),
  report("plan", { recommended: true, share: { percent: 100, risk: 5 }, factors: { [planner.id]: { factor: 0.5, risk: 0 } } }),
];

/** Объём — два пункта «Готово, когда»: $6 и 30 минут. */
const brief: DecisionBrief = stagedBrief(reports, { setup: { stages: reports, criteria: [{ text: "Первое", add: add(4, 6, 0, 20) }, { text: "Второе", add: add(2, 3, 0, 10) }] } });

describe("план этапов при цене от объёма", () => {
  it("этап получает свою долю объёма с множителем исполнителя", () => {
    const answer: DecisionAnswer = { briefId: brief.id, answers: [], stages: [{ id: "spec", run: true, executor: "self" }, { id: "plan", run: true, executor: planner.id }] };
    expect(stagePlans(brief, answer)).toEqual({ spec: { minutes: 6, target: 1.2 }, plan: { minutes: 15, target: 3 } });
  });
});
