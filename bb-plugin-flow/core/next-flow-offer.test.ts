// @vitest-environment node
import { describe, expect, it } from "vitest";

import { QUICK_STAGES, stage } from "./stages-fixtures";
import { hasApprovalStage, nextFlowOffer, otherFlowsOf } from "./next-flow-offer";
import type { WorkStage } from "../shared/contract";

const APPROVE: WorkStage = { id: "approve", kind: "approve", skill: "", name: "Approval", executors: [] };

describe("предложение flow на Утверждении", () => {
  it("Утверждение в этапах — предлагать flow есть где, без него — нет", () => {
    expect(hasApprovalStage([stage("work"), APPROVE])).toBe(true);
    expect(hasApprovalStage(QUICK_STAGES.filter((s) => s.kind !== "approve"))).toBe(false);
  });

  it("правило называет outcome.nextFlow, main и flow владельца по id и названию", () => {
    const text = nextFlowOffer([{ id: "quick", name: "Quick" }], false);
    expect(text).toContain("outcome.nextFlow");
    expect(text).toContain("main");
    expect(text).toContain('quick "Quick"');
  });

  it("не влезший список отсылает к read_flows, даже когда не влез ни один flow", () => {
    expect(nextFlowOffer([{ id: "quick", name: "Quick" }], true)).toContain("read_flows");
    expect(nextFlowOffer([], true)).toContain("read_flows");
  });

  it("других flow нет — предлагать нечего", () => {
    expect(nextFlowOffer([], false)).toBeNull();
  });
});

describe("куда Утверждение может перевести работу", () => {
  it("в список идут все flow владельца, кроме текущего, — по id и названию", () => {
    const flows = [{ id: "answer", name: "Answer" }, { id: "quick", name: "Quick" }];
    expect(otherFlowsOf(flows, "answer")).toEqual([{ id: "quick", name: "Quick" }]);
    expect(otherFlowsOf(flows, undefined)).toEqual(flows);
  });
});
