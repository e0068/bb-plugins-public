// @vitest-environment node
// Имя этапа, целиком входящее в имя другого этапа, этап не называет: «Plan review» не называет Plan.
import { describe, expect, it } from "vitest";

import type { FlowProgress } from "../shared/contract";
import { unnamedProposals } from "./approval-guard";
import { stage } from "./stages-fixtures";

const STAGES = [stage("plan", { name: "Plan" }), stage("plan-review", { name: "Plan review" }), stage("tests", { name: "Тесты" }), stage("e2e", { name: "Тесты e2e" })];
const proposed: FlowProgress = { stages: { plan: { skipped: true, proposed: true }, tests: { skipped: true, proposed: true } }, waiting: [] };
const unnamed = (text: string) => unnamedProposals(STAGES, proposed, text).map((s) => s.id);

describe("имя этапа внутри имени другого этапа", () => {
  it("«Plan review» и «Тесты e2e» названы, а предложенные к снятию Plan и «Тесты» — нет", () => {
    expect(unnamed("Взяты: Plan review, Тесты e2e")).toEqual(["plan", "tests"]);
  });

  it("имя этапа названо отдельно от более длинного имени — этап назван", () => {
    expect(unnamed("Не выполняем: Plan и Тесты — исполняю сам; Plan review и Тесты e2e беру")).toEqual([]);
  });

  it("длинное имя названо до короткого — короткое всё равно требует своего упоминания", () => {
    expect(unnamed("Plan review, затем Plan")).toEqual(["tests"]);
  });
});
