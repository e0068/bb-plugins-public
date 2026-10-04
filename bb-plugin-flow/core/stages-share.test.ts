// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { SELF, stageAdd } from "./stages";
import { add, planner, report, stage } from "./stages-fixtures";

const plan = stage("plan", { name: "План", executors: [planner] });
const item = (percent: number, factor = 1) => ({ stage: plan, report: report("plan", { share: { percent, risk: -1 }, factors: { [planner.id]: { factor, risk: 1 } } }) });
const scope = add(10, 20, 0, 60);

describe("цена этапа — доля объёма", () => {
  it("сам агент — объём × процент, риск — свой", () => {
    expect(stageAdd(item(30), SELF, scope)).toEqual({ target: 3, max: 6, risk: -1, minutes: 18 });
  });

  it("исполнитель — множитель к доле и свой риск сверху", () => {
    expect(stageAdd(item(100, 0.8), planner.id, scope)).toEqual({ target: 8, max: 16, risk: 0, minutes: 48 });
  });

  it("без объёма у этапа остаётся только риск", () => {
    expect(stageAdd(item(30), SELF, undefined)).toEqual({ target: 0, max: 0, risk: -1 });
  });

  it("автоматизация не стоит ничего", () => {
    const automated = { stage: { ...plan, automation: { source: "flow" as const, steps: [] } }, report: item(30).report };
    expect(stageAdd(automated, SELF, scope)).toBeUndefined();
  });

  it("старый этап с долларами считается как раньше и от объёма не зависит", () => {
    const old = { stage: plan, report: report("plan", { add: add(4, 7, -1, 15), adds: { [planner.id]: add(2, 4, -1, 10) } }) };
    expect(stageAdd(old, planner.id, scope)).toEqual({ target: 6, max: 11, risk: -2, minutes: 25 });
  });

  it("цена не уходит ниже нуля и растёт вместе с объёмом", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 500, noNaN: true }), fc.double({ min: 0.01, max: 5, noNaN: true }), fc.integer({ min: 0, max: 300 }), (percent, factor, base) => {
        const one = stageAdd(item(percent, factor), planner.id, add(base, base * 2, 0, base))!;
        const two = stageAdd(item(percent, factor), planner.id, add(base * 2, base * 4, 0, base * 2))!;
        expect(one.target).toBeGreaterThanOrEqual(0);
        expect(one.minutes ?? 0).toBeGreaterThanOrEqual(0);
        expect(two.target).toBeCloseTo(one.target * 2, 1);
      }),
    );
  });
});
