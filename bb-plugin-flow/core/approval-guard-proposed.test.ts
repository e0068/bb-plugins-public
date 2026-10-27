// @vitest-environment node
// Утверждение после выбора этапов называет каждый этап, который агент предложил не выполнять: владелец видит, на что соглашается.
import { describe, expect, it } from "vitest";

import type { FlowProgress } from "../shared/contract";
import { approvalIssues, unnamedProposals } from "./approval-guard";
import { stage } from "./stages-fixtures";

const STAGES = [stage("spec", { name: "Спецификация" }), stage("plan", { name: "План" }), stage("code", { name: "Код" })];
const proposed = (...ids: string[]): FlowProgress => ({ stages: Object.fromEntries(ids.map((id) => [id, { skipped: true, proposed: true }])), waiting: [] });

describe("этапы, предложенные агентом к снятию, названы в утверждении", () => {
  it("этап, названный по имени, названным считается", () => {
    expect(unnamedProposals(STAGES, proposed("spec"), "Не выполняем: Спецификация — нет нового узла")).toEqual([]);
  });

  it("этап, названный по id, названным считается", () => {
    expect(unnamedProposals(STAGES, proposed("spec"), "не берём spec, нет нового узла")).toEqual([]);
  });

  it("неназванные этапы возвращаются в порядке flow", () => {
    expect(unnamedProposals(STAGES, proposed("plan", "spec"), "Не выполняем: Код").map((s) => s.id)).toEqual(["spec", "plan"]);
  });

  it("предложенных к снятию этапов нет — называть нечего", () => {
    expect(unnamedProposals(STAGES, { stages: { spec: { skipped: true } }, waiting: [] }, "")).toEqual([]);
  });
});

describe("отказ утверждению, которое не называет предложенный к снятию этап", () => {
  it("отказ называет этап", () => {
    const [issue] = approvalIssues(STAGES, proposed("plan"), "approve", false, "Утверждаем прогон");
    expect(issue).toMatch(/plan/);
    expect(issue).toMatch(/План/);
  });

  it("этап назван — отказа нет", () => {
    expect(approvalIssues(STAGES, proposed("plan"), "approve", false, "Не выполняем: План — исполняю сам")).toEqual([]);
  });
});
