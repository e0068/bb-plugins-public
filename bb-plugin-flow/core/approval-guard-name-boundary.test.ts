// @vitest-environment node
// Этап назван в утверждении, когда его имя стоит словом, а не кусочком другого слова.
import { describe, expect, it } from "vitest";

import type { FlowProgress } from "../shared/contract";
import { unnamedProposals } from "./approval-guard";
import { stage } from "./stages-fixtures";

const STAGES = [stage("plan", { name: "Plan" }), stage("pr", { name: "PR" })];
const proposed: FlowProgress = { stages: { plan: { skipped: true, proposed: true }, pr: { skipped: true, proposed: true } }, waiting: [] };
const unnamed = (text: string) => unnamedProposals(STAGES, proposed, text).map((s) => s.id);

describe("имя этапа в тексте утверждения — слово, а не часть слова", () => {
  it("«planned» и «PRoject» этапы Plan и PR не называют", () => {
    expect(unnamed("planned the work, opened a PRoject")).toEqual(["plan", "pr"]);
  });

  it("«approve» этап PR не называет", () => {
    expect(unnamed("Plan: исполняю сам; утверждаем approve")).toEqual(["pr"]);
  });

  it("имя словом называет этап, регистр не важен", () => {
    expect(unnamed("Не выполняем: plan и pr — нет нового узла")).toEqual([]);
  });

  it("имя рядом со знаком препинания называет этап", () => {
    expect(unnamed("Не берём «Plan», (PR).")).toEqual([]);
  });
});
