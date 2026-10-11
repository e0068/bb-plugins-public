import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { factArgs, parseContributions, planArgs, shareOf, totalOf, withContribution, type Contributions } from "./task-figures";

describe("planArgs", () => {
  it("writes planned minutes, budget and limit", () => {
    expect(planArgs("BBPL-1", { minutes: 51, target: 12.52, max: 25.03 })).toEqual([
      "tasks", "update", "BBPL-1", "--minutes", "51", "--budget", "12.52", "--limit", "25.03", "--json",
    ]);
  });

  it("leaves the minutes out when the plan has none", () => {
    expect(planArgs("BBPL-1", { minutes: null, target: 3, max: 6 })).toEqual(["tasks", "update", "BBPL-1", "--budget", "3", "--limit", "6", "--json"]);
  });

  it("rounds minutes to whole and money to the cent, never below zero", () => {
    expect(planArgs("k", { minutes: 12.6, target: 1.006, max: -2 })).toEqual(["tasks", "update", "k", "--minutes", "13", "--budget", "1.01", "--limit", "0", "--json"]);
  });
});

describe("factArgs", () => {
  it("writes actual minutes and cost", () => {
    expect(factArgs("BBPL-1", { minutes: 47, cost: 9.814 })).toEqual(["tasks", "update", "BBPL-1", "--minutes-actual", "47", "--cost", "9.81", "--json"]);
  });

  it("rounds the spend down: a task never shows more than was spent", () => {
    expect(factArgs("k", { minutes: 22.9, cost: 4.996 }).slice(3, 7)).toEqual(["--minutes-actual", "22", "--cost", "4.99"]);
    expect(factArgs("k", { minutes: 3, cost: 0.29 }).slice(3, 7)).toEqual(["--minutes-actual", "3", "--cost", "0.29"]);
  });
});

describe("shareOf", () => {
  it("splits a run evenly between its tasks, and the shares add up to the run", () => {
    fc.assert(
      fc.property(spent, fc.integer({ min: 1, max: 9 }), (s, n) => {
        const share = shareOf(s, n);
        expect(share.minutes * n).toBeCloseTo(s.minutes, 6);
        expect(share.cost * n).toBeCloseTo(s.cost, 6);
      }),
    );
  });
});

const thread = fc.stringMatching(/^thr_[a-z0-9]{1,6}$/);
const spent = fc.record({ minutes: fc.nat(10_000), cost: fc.integer({ min: 0, max: 100_000 }).map((c) => c / 100) });
const contributions = fc.dictionary(thread, spent);

describe("contributions of threads", () => {
  it("a second thread adds its spend to the first", () => {
    const one = withContribution({}, "thr_a", { minutes: 10, cost: 2 });
    expect(totalOf(withContribution(one, "thr_b", { minutes: 5, cost: 1.5 }))).toEqual({ minutes: 15, cost: 3.5 });
  });

  it("a repeated step of the same thread replaces its spend instead of adding it again", () => {
    fc.assert(
      fc.property(contributions, thread, spent, (stored, id, own) => {
        const once = withContribution(stored, id, own);
        expect(totalOf(withContribution(once, id, own))).toEqual(totalOf(once));
      }),
    );
  });

  it("the total does not depend on the order the threads wrote in", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(thread, spent), { maxLength: 6 }), (writes) => {
        const forward = writes.reduce<Contributions>((acc, [id, s]) => withContribution(acc, id, s), {});
        const last = new Map(writes.map(([id, s]) => [id, s]));
        const backward = [...last].reverse().reduce<Contributions>((acc, [id, s]) => withContribution(acc, id, s), {});
        expect(totalOf(forward)).toEqual(totalOf(backward));
      }),
    );
  });

  it("nothing written means nothing spent", () => {
    expect(totalOf({})).toEqual({ minutes: 0, cost: 0 });
  });

  it("reads back what it stored and reads junk as no contributions", () => {
    fc.assert(fc.property(contributions, (stored) => {
      expect(parseContributions(JSON.parse(JSON.stringify(stored)))).toEqual({ ...stored });
    }));
    expect(parseContributions(undefined)).toEqual({});
    expect(parseContributions("not json")).toEqual({});
    expect(parseContributions({ thr_a: { minutes: "x", cost: 1 }, thr_b: { minutes: 2, cost: 3 } })).toEqual({ thr_b: { minutes: 2, cost: 3 } });
  });
});
