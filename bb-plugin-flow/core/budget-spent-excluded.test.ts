// @vitest-environment node
import { describe, expect, it } from "vitest";

import { budgetLine, forecast } from "./budget";
import { add, report, stagedBrief } from "./stages-fixtures";

const brief = stagedBrief([report("plan", { add: add(4, 7, 1, 15) })], { planning: { minutes: 600, cost: 74.24 } });

describe("итог прогноза без уже потраченного", () => {
  it("без этапов в прогоне итог нулевой, хотя тред уже стоил денег", () => {
    const f = forecast(brief, { briefId: brief.id, answers: [], stages: [{ id: "plan", run: false, executor: "self", review: true }] });
    expect(f).toMatchObject({ target: 0, max: 0, risk: 0, minutes: 0 });
  });

  it("итог — только этапы в прогоне; планирование остаётся справочной строкой", () => {
    const f = forecast(brief, { briefId: brief.id, answers: [], stages: [{ id: "plan", run: true, executor: "self", review: true }] });
    expect(f).toMatchObject({ target: 4, max: 7, risk: 1, minutes: 15, spent: 1 });
    expect(f.lines[0]?.target).toBe(74.24);
  });
});

describe("уже потраченное — справка, не итог", () => {
  it("время итога — только запланированное, минуты планирования не входят", () => {
    const f = forecast(brief, { briefId: brief.id, answers: [], stages: [{ id: "plan", run: true, executor: "self", review: true }] });
    expect(f.minutes).toBe(15);
  });

  it("реплика агенту называет бюджет без цены треда", () => {
    const f = forecast(brief, { briefId: brief.id, answers: [], stages: [{ id: "plan", run: true, executor: "self", review: true }] });
    expect(budgetLine(brief, { briefId: brief.id, answers: [], stages: [{ id: "plan", run: true, executor: "self", review: true }] })).toEqual([
      `Бюджет — прогноз $${f.target} · до $${f.max}, риск +1, время 15 мин`,
    ]);
  });
});
