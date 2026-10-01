// @vitest-environment node
import { describe, expect, it } from "vitest";

import { stageReportSchema, type StageReport } from "../shared/contract";
import { STAGES, stagedBrief } from "./stages-fixtures";
import { reportIssues, stageAdd, stageItems } from "./stages";

const parsed = (id: string, patch: Record<string, unknown> = {}): StageReport => stageReportSchema.parse({ id, state: "todo", ...patch });

describe("отчёт с adds.self и перевёрнутой экономией", () => {
  const reports = [parsed("task", { adds: { self: { target: -1, max: -3, risk: 0 } } }), parsed("spec"), parsed("plan", { add: { target: -2, max: -4, risk: -1 } })];

  it("бриф принимается", () => {
    expect(reportIssues(STAGES, reports)).toEqual([]);
  });

  it("бюджет этапа считается по диапазону от меньшей границы к большей", () => {
    const items = stageItems(stagedBrief(reports));
    expect(items.map((item) => stageAdd(item, "self"))).toEqual([{ target: -3, max: -1, risk: 0 }, undefined, { target: -4, max: -2, risk: -1 }]);
  });
});
