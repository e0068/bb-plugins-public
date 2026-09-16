import { describe, expect, it } from "vitest";
import { planMergeTimeBump } from "./merge-time-bump";

const pkg = (version: string): string => JSON.stringify({ name: "bb-plugin-x", version }, null, 2);

describe("planMergeTimeBump", () => {
  it("the branch already carries a higher version than the base → nothing to do", () => {
    expect(planMergeTimeBump(pkg("0.2.12"), pkg("0.2.11"))).toEqual({ kind: "ahead" });
  });

  it("both sides sit on the same version → bump one patch past it", () => {
    expect(planMergeTimeBump(pkg("0.2.11"), pkg("0.2.11"))).toEqual({ kind: "bump", to: "0.2.12" });
  });

  it("the base moved past the branch's bump → bump past the BASE, not past the branch", () => {
    // The classic miss: a neighbouring PR landed 0.2.11 while this branch
    // still carried the 0.2.10 it was cut from. Bumping the branch's own
    // value would land on 0.2.11 again — a version that already exists.
    expect(planMergeTimeBump(pkg("0.2.10"), pkg("0.2.11"))).toEqual({ kind: "bump", to: "0.2.12" });
  });

  it("compares numerically, not as text — 0.2.9 is behind 0.2.10", () => {
    expect(planMergeTimeBump(pkg("0.2.9"), pkg("0.2.10"))).toEqual({ kind: "bump", to: "0.2.11" });
  });

  it("a minor ahead of the base wins whatever the patch says", () => {
    expect(planMergeTimeBump(pkg("0.3.0"), pkg("0.2.99"))).toEqual({ kind: "ahead" });
  });

  it("the plugin is new — nothing on the base to outgrow → nothing to do", () => {
    expect(planMergeTimeBump(pkg("0.1.0"), null)).toEqual({ kind: "ahead" });
  });

  it("no package.json on the branch → unknown, and say why", () => {
    expect(planMergeTimeBump(null, pkg("0.2.11"))).toEqual({
      kind: "unknown",
      reason: "no readable version on the branch",
    });
  });

  it("a version that is not a plain x.y.z is left to a human", () => {
    expect(planMergeTimeBump(pkg("1.0.0-rc.1"), pkg("0.9.9"))).toEqual({
      kind: "unknown",
      reason: "no readable version on the branch",
    });
  });

  it("a base version that is not a plain x.y.z is left to a human too", () => {
    expect(planMergeTimeBump(pkg("0.2.10"), pkg("nightly"))).toEqual({
      kind: "unknown",
      reason: "no readable version on the base",
    });
  });

  it("unparseable JSON reads as no version, not as a crash", () => {
    expect(planMergeTimeBump("{ not json", pkg("0.2.11"))).toEqual({
      kind: "unknown",
      reason: "no readable version on the branch",
    });
  });
});
