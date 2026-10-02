// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { stagePlans } from "./budget";
import { add, report, stagedBrief } from "./stages-fixtures";

const reports = [report("spec", { recommended: true, share: { percent: 20, risk: -1 } })];
const brief: DecisionBrief = stagedBrief(reports, { setup: { stages: reports, criteria: [{ text: "Единственный", add: add(4, 6, 0, 20) }] } });

describe("план этапа без цены объёма", () => {
  it("владелец снял все пункты «Готово, когда» — этап плана не получает, а не «~$0»", () => {
    const answer: DecisionAnswer = { briefId: brief.id, answers: [], stages: [{ id: "spec", run: true, executor: "self" }], criteria: { removed: [0], edited: [], added: [] } };
    expect(stagePlans(brief, answer)).toEqual({});
  });
});
