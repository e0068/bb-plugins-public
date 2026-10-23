import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { familyOf, sumTotals, usageTotalsOf, type ThreadNode, type UsageTotals } from "../thread-family";
import type { TokensTotals } from "../types";

const node = (id: string, parentThreadId: string | null = null, title: string | null = null): ThreadNode => ({ id, parentThreadId, title });

const ids = (nodes: readonly ThreadNode[]) => nodes.map((n) => n.id);

function totals(over: Partial<UsageTotals> = {}): UsageTotals {
  return {
    total: 0,
    input: 0,
    cacheWrite: 0,
    cacheRead: 0,
    output: 0,
    thinking: 0,
    cost: 0,
    messages: 0,
    costs: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0 },
    ...over,
  };
}

describe("familyOf", () => {
  it("is just the thread itself when nothing points at it as a parent", () => {
    expect(ids(familyOf("root", [node("root"), node("other")]))).toEqual(["root"]);
  });

  it("puts the thread first, then its children, then theirs, level by level", () => {
    const threads = [node("g1", "c1"), node("c1", "root"), node("c2", "root"), node("root"), node("g2", "c2")];
    expect(ids(familyOf("root", threads))).toEqual(["root", "c1", "c2", "g1", "g2"]);
  });

  it("keeps the order of the list among siblings", () => {
    const threads = [node("b", "root"), node("a", "root"), node("root")];
    expect(ids(familyOf("root", threads))).toEqual(["root", "b", "a"]);
  });

  it("leaves out threads of other families", () => {
    const threads = [node("root"), node("c", "root"), node("x"), node("y", "x")];
    expect(ids(familyOf("root", threads))).toEqual(["root", "c"]);
  });

  it("starts from a child as well: its family is the child and its own descendants", () => {
    const threads = [node("root"), node("c", "root"), node("g", "c")];
    expect(ids(familyOf("c", threads))).toEqual(["c", "g"]);
  });

  it("names the thread even when it is missing from the list (older than the scanned window)", () => {
    expect(familyOf("gone", [node("c", "gone")])).toEqual([node("gone"), node("c", "gone")]);
  });

  it("takes each thread once even when parents point at each other", () => {
    const threads = [node("a", "b"), node("b", "a")];
    expect(ids(familyOf("a", threads))).toEqual(["a", "b"]);
  });

  it("keeps the titles it was given", () => {
    expect(familyOf("root", [node("root", null, "Parent"), node("c", "root", "Child")]).map((n) => n.title)).toEqual(["Parent", "Child"]);
  });
});

describe("sumTotals", () => {
  it("is all zeros for no threads", () => {
    expect(sumTotals([])).toEqual(totals());
  });

  it("adds every counter and every cost part", () => {
    const a = totals({ total: 10, input: 1, cacheWrite: 2, cacheRead: 3, output: 4, thinking: 1, cost: 1.5, messages: 2, costs: { input: 0.1, cacheWrite: 0.2, cacheRead: 0.3, output: 0.9, thinking: 0.4 } });
    const b = totals({ total: 5, input: 1, cacheWrite: 1, cacheRead: 1, output: 2, thinking: 0, cost: 0.75, messages: 1, costs: { input: 0.05, cacheWrite: 0.1, cacheRead: 0.1, output: 0.5, thinking: 0 } });
    expect(sumTotals([a, b])).toEqual(
      totals({ total: 15, input: 2, cacheWrite: 3, cacheRead: 4, output: 6, thinking: 1, cost: 2.25, messages: 3, costs: { input: 0.15, cacheWrite: 0.3, cacheRead: 0.4, output: 1.4, thinking: 0.4 } }),
    );
  });

  it("keeps the cost sum on whole cents, without floating-point tails", () => {
    expect(sumTotals([totals({ cost: 0.1 }), totals({ cost: 0.2 })]).cost).toBe(0.3);
  });

  it("lists models without a price once, from every thread, and omits the list when there are none", () => {
    expect(sumTotals([totals({ unpricedModels: ["m2", "m1"] }), totals({ unpricedModels: ["m1"] }), totals()]).unpricedModels).toEqual(["m1", "m2"]);
    expect("unpricedModels" in sumTotals([totals(), totals()])).toBe(false);
  });

  it("does not depend on the order of the threads", () => {
    const counts = fc.record({ total: fc.nat(1_000_000), messages: fc.nat(1000), cost: fc.nat(100_000).map((cents) => cents / 100) });
    fc.assert(
      fc.property(fc.array(counts, { maxLength: 8 }), (rows) => {
        const list = rows.map((r) => totals(r));
        expect(sumTotals([...list].reverse())).toEqual(sumTotals(list));
      }),
    );
  });
});

describe("usageTotalsOf", () => {
  it("reads the report totals, merging the two cache-write lifetimes into one", () => {
    const report: TokensTotals = {
      total: 100,
      input: 10,
      cacheWrite5m: 20,
      cacheWrite1h: 5,
      cacheRead: 55,
      output: 10,
      thinking: 3,
      messages: 4,
      cost: 1.25,
      unpricedModels: ["m"],
      costs: { input: 0.1, cacheWrite: 0.4, cacheRead: 0.3, output: 0.45, thinking: 0.1 },
      models: [],
      buckets: 2,
    };
    expect(usageTotalsOf(report)).toEqual({
      total: 100,
      input: 10,
      cacheWrite: 25,
      cacheRead: 55,
      output: 10,
      thinking: 3,
      messages: 4,
      cost: 1.25,
      unpricedModels: ["m"],
      costs: report.costs,
    });
  });

  it("has no unpricedModels key when the report has none", () => {
    const report: TokensTotals = {
      total: 0, input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0, thinking: 0, messages: 0, cost: 0,
      costs: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0 }, models: [], buckets: 0,
    };
    expect("unpricedModels" in usageTotalsOf(report)).toBe(false);
  });
});
