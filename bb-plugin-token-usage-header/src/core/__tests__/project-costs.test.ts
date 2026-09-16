import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  COST_WINDOWS,
  COST_WINDOW_MS,
  ROW_LIMIT_OPTIONS,
  THREADS_BUCKET_LABEL,
  allProjectKeys,
  donutArcs,
  limitRows,
  projectCostSlices,
  resolveProjectSelection,
  threadCostInWindow,
  threadCostRows,
  threadDisplayLabel,
  windowMayBeIncomplete,
  windowStartMs,
  type ProjectSelection,
} from "../project-costs";
import type { ThreadEntry, TimelineBin } from "../threads-timeline";

const HOUR_MS = 3_600_000;
/** Fixed "now" for every test — the core never reads the clock, so this is the only source of time. */
const NOW_MS = Date.parse("2026-09-03T12:00:00.000Z");

function bin(offsetHours: number, total: number): TimelineBin {
  return {
    t: new Date(NOW_MS - offsetHours * HOUR_MS).toISOString(),
    agents: total === 0 ? [] : [{ key: "main", total }],
  };
}

function thread(overrides: Partial<ThreadEntry> = {}): ThreadEntry {
  const bins = overrides.bins ?? [bin(2, 100)];
  return {
    session: "sess-1",
    project: "-Users-e0068-Projects-demo",
    title: "sess-1",
    start: new Date(NOW_MS - 3 * HOUR_MS).toISOString(),
    end: new Date(NOW_MS - HOUR_MS).toISOString(),
    durationSec: 7200,
    totalTokens: 100,
    totalCost: 10,
    workflowCount: 0,
    cwd: null,
    gitBranch: null,
    events: [],
    bbProjectId: null,
    bbProjectName: "Demo",
    threadId: null,
    bbThreadTitle: null,
    isAlive: false,
    isWorking: false,
    ...overrides,
    bins,
  };
}

/** Threads with arbitrary bin layouts and costs — the input class every law below quantifies over. */
const threadArb = fc
  .record({
    session: fc.string({ minLength: 1, maxLength: 12 }),
    // Rounded to micro-dollars: real costs come from tokens × price-per-token,
    // never a subnormal double — an unrounded double can generate values like
    // 5e-324, which underflow to exactly 0 once divided by a normal cost.
    totalCost: fc.double({ min: 0, max: 1000, noNaN: true }).map((n) => Math.round(n * 1e6) / 1e6),
    project: fc.constantFrom<string | null>("Alpha", "Beta", null),
    bins: fc.array(
      fc.record({ offsetHours: fc.double({ min: 0, max: 1000, noNaN: true }), total: fc.nat({ max: 1_000_000 }) }),
      { maxLength: 12 },
    ),
    endOffsetHours: fc.double({ min: 0, max: 1000, noNaN: true }),
  })
  .map(({ session, totalCost, project, bins, endOffsetHours }) =>
    thread({
      session,
      totalCost,
      bbProjectName: project,
      end: new Date(NOW_MS - endOffsetHours * HOUR_MS).toISOString(),
      bins: bins.map((b) => bin(b.offsetHours, b.total)),
    }),
  );

describe("windowStartMs", () => {
  it("subtracts the window's own length from now", () => {
    expect(windowStartMs("day", NOW_MS)).toBe(NOW_MS - 24 * HOUR_MS);
    expect(windowStartMs("week", NOW_MS)).toBe(NOW_MS - 7 * 24 * HOUR_MS);
    expect(windowStartMs("month", NOW_MS)).toBe(NOW_MS - 30 * 24 * HOUR_MS);
  });

  it("orders the three windows from shortest to longest", () => {
    const lengths = COST_WINDOWS.map((w) => COST_WINDOW_MS[w]);
    expect(lengths).toEqual([...lengths].sort((a, b) => a - b));
  });
});

describe("windowMayBeIncomplete", () => {
  it("reads false when the slice wasn't truncated at all, however old the window", () => {
    const t = thread({ end: new Date(NOW_MS - HOUR_MS).toISOString() });
    expect(windowMayBeIncomplete([t], NOW_MS - 30 * 24 * HOUR_MS, false)).toBe(false);
  });

  it("reads false for an empty slice — nothing was cut off from nothing", () => {
    expect(windowMayBeIncomplete([], NOW_MS - 24 * HOUR_MS, true)).toBe(false);
  });

  it("reads false when the slice is truncated but every fetched thread is already older than the window's start", () => {
    // The window only needs the last 2 hours; the one thread we have is 3
    // hours old — plenty to cover it, whatever was cut off is even older.
    const t = thread({ end: new Date(NOW_MS - 3 * HOUR_MS).toISOString() });
    expect(windowMayBeIncomplete([t], NOW_MS - 2 * HOUR_MS, true)).toBe(false);
  });

  it("reads true when the slice is truncated and the oldest thread is inside the window (nothing left to cover the rest)", () => {
    const t = thread({ end: new Date(NOW_MS - HOUR_MS).toISOString() });
    expect(windowMayBeIncomplete([t], NOW_MS - 2 * HOUR_MS, true)).toBe(true);
  });

  it("reads true at the exact boundary — the oldest thread's end equals the window's start", () => {
    const t = thread({ end: new Date(NOW_MS - 2 * HOUR_MS).toISOString() });
    expect(windowMayBeIncomplete([t], NOW_MS - 2 * HOUR_MS, true)).toBe(true);
  });

  it("law: never true when the slice isn't truncated — sliceTruncated gates everything else", () => {
    fc.assert(
      fc.property(fc.array(threadArb, { maxLength: 10 }), fc.double({ min: 0, max: 2000, noNaN: true }), (threads, offsetHours) => {
        expect(windowMayBeIncomplete(threads, NOW_MS - offsetHours * HOUR_MS, false)).toBe(false);
      }),
    );
  });
});

describe("threadCostInWindow", () => {
  it("prorates by the share of tokens whose bins start inside the window", () => {
    const t = thread({ totalCost: 12, bins: [bin(10, 300), bin(1, 100)] });
    // 100 of 400 tokens inside a 2-hour window -> a quarter of the cost.
    expect(threadCostInWindow(t, NOW_MS - 2 * HOUR_MS)).toBeCloseTo(3, 10);
  });

  it("counts a bin whose start is exactly the window boundary", () => {
    const t = thread({ totalCost: 8, bins: [bin(2, 100)] });
    expect(threadCostInWindow(t, NOW_MS - 2 * HOUR_MS)).toBeCloseTo(8, 10);
  });

  it("falls back to the thread's last activity when no bin carries tokens", () => {
    const empty = [bin(5, 0)];
    const inside = thread({ totalCost: 7, bins: empty, end: new Date(NOW_MS - HOUR_MS).toISOString() });
    const outside = thread({ totalCost: 7, bins: empty, end: new Date(NOW_MS - 10 * HOUR_MS).toISOString() });
    expect(threadCostInWindow(inside, NOW_MS - 2 * HOUR_MS)).toBe(7);
    expect(threadCostInWindow(outside, NOW_MS - 2 * HOUR_MS)).toBe(0);
  });

  it("ignores a bin with an unparseable timestamp instead of throwing", () => {
    const t = thread({ totalCost: 10, bins: [{ t: "not-a-date", agents: [{ key: "main", total: 100 }] }, bin(1, 100)] });
    expect(threadCostInWindow(t, NOW_MS - 2 * HOUR_MS)).toBeCloseTo(5, 10);
  });

  it("law: a window covering the whole thread returns its full cost", () => {
    fc.assert(
      fc.property(threadArb, (t) => {
        const cost = threadCostInWindow(t, Number.NEGATIVE_INFINITY);
        expect(cost).toBeCloseTo(t.totalCost, 8);
      }),
    );
  });

  it("law: a window that starts in the future returns nothing", () => {
    fc.assert(
      fc.property(threadArb, (t) => {
        expect(threadCostInWindow(t, NOW_MS + 10 * HOUR_MS)).toBe(0);
      }),
    );
  });

  it("law: the result always stays within [0, totalCost]", () => {
    fc.assert(
      fc.property(threadArb, fc.double({ min: 0, max: 2000, noNaN: true }), (t, offsetHours) => {
        const cost = threadCostInWindow(t, NOW_MS - offsetHours * HOUR_MS);
        expect(cost).toBeGreaterThanOrEqual(0);
        expect(cost).toBeLessThanOrEqual(t.totalCost + 1e-9);
      }),
    );
  });

  it("law: widening the window never lowers the cost", () => {
    fc.assert(
      fc.property(
        threadArb,
        fc.double({ min: 0, max: 2000, noNaN: true }),
        fc.double({ min: 0, max: 2000, noNaN: true }),
        (t, a, b) => {
          const wider = Math.max(a, b);
          const narrower = Math.min(a, b);
          const costWider = threadCostInWindow(t, NOW_MS - wider * HOUR_MS);
          const costNarrower = threadCostInWindow(t, NOW_MS - narrower * HOUR_MS);
          expect(costWider).toBeGreaterThanOrEqual(costNarrower - 1e-9);
        },
      ),
    );
  });
});

describe("projectCostSlices", () => {
  it("groups by BB project, sorts by cost descending and names the unmatched bucket", () => {
    const threads = [
      thread({ session: "a", bbProjectName: "Alpha", totalCost: 5 }),
      thread({ session: "b", bbProjectName: null, totalCost: 9 }),
      thread({ session: "c", bbProjectName: "Alpha", totalCost: 1 }),
    ];
    const slices = projectCostSlices(threads, Number.NEGATIVE_INFINITY);
    expect(slices.map((s) => [s.label, s.cost])).toEqual([
      [THREADS_BUCKET_LABEL, 9],
      ["Alpha", 6],
    ]);
    expect(slices[0].key).toBeNull();
    expect(slices[1].key).toBe("Alpha");
  });

  it("drops projects that spent nothing inside the window", () => {
    const threads = [
      thread({ session: "a", bbProjectName: "Alpha", totalCost: 5, bins: [bin(1, 100)] }),
      thread({ session: "b", bbProjectName: "Beta", totalCost: 5, bins: [bin(50, 100)] }),
    ];
    expect(projectCostSlices(threads, NOW_MS - 2 * HOUR_MS).map((s) => s.label)).toEqual(["Alpha"]);
  });

  it("returns an empty list for no threads instead of a zero-cost bucket", () => {
    expect(projectCostSlices([], NOW_MS)).toEqual([]);
  });

  it("law: shares sum to 1 and each slice's share matches its own cost", () => {
    fc.assert(
      fc.property(fc.array(threadArb, { maxLength: 10 }), (threads) => {
        const slices = projectCostSlices(threads, Number.NEGATIVE_INFINITY);
        if (slices.length === 0) return;
        const total = slices.reduce((sum, s) => sum + s.cost, 0);
        expect(slices.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 8);
        slices.forEach((s) => expect(s.share).toBeCloseTo(s.cost / total, 8));
      }),
    );
  });

  it("law: the slices' total equals the sum of every thread's windowed cost", () => {
    fc.assert(
      fc.property(fc.array(threadArb, { maxLength: 10 }), fc.double({ min: 0, max: 2000, noNaN: true }), (threads, offsetHours) => {
        const fromMs = NOW_MS - offsetHours * HOUR_MS;
        const slicesTotal = projectCostSlices(threads, fromMs).reduce((sum, s) => sum + s.cost, 0);
        const threadsTotal = threads.reduce((sum, t) => sum + threadCostInWindow(t, fromMs), 0);
        expect(slicesTotal).toBeCloseTo(threadsTotal, 6);
      }),
    );
  });
});

describe("threadCostRows", () => {
  it("sorts by cost descending and scales bars against the most expensive row", () => {
    const threads = [
      thread({ session: "a", totalCost: 2 }),
      thread({ session: "b", totalCost: 8 }),
      thread({ session: "c", totalCost: 4 }),
    ];
    const rows = threadCostRows(threads, Number.NEGATIVE_INFINITY, { kind: "all" });
    expect(rows.map((r) => r.session)).toEqual(["b", "c", "a"]);
    expect(rows.map((r) => r.barFraction)).toEqual([1, 0.5, 0.25]);
  });

  it("keeps only the selected project, and tells the unmatched bucket from a named one", () => {
    const threads = [
      thread({ session: "a", bbProjectName: "Alpha" }),
      thread({ session: "b", bbProjectName: null }),
    ];
    const all = threadCostRows(threads, Number.NEGATIVE_INFINITY, { kind: "all" });
    const alpha = threadCostRows(threads, Number.NEGATIVE_INFINITY, { kind: "project", key: "Alpha" });
    const unmatched = threadCostRows(threads, Number.NEGATIVE_INFINITY, { kind: "project", key: null });
    expect(all.map((r) => r.session).sort()).toEqual(["a", "b"]);
    expect(alpha.map((r) => r.session)).toEqual(["a"]);
    expect(unmatched.map((r) => r.session)).toEqual(["b"]);
  });

  it("drops threads that spent nothing inside the window", () => {
    const threads = [
      thread({ session: "a", bins: [bin(1, 100)] }),
      thread({ session: "b", bins: [bin(80, 100)] }),
    ];
    expect(threadCostRows(threads, NOW_MS - 2 * HOUR_MS, { kind: "all" }).map((r) => r.session)).toEqual(["a"]);
  });

  it("law: bar fractions stay in (0, 1] and the first row is always full width", () => {
    fc.assert(
      fc.property(fc.array(threadArb, { maxLength: 10 }), (threads) => {
        const rows = threadCostRows(threads, Number.NEGATIVE_INFINITY, { kind: "all" });
        if (rows.length === 0) return;
        expect(rows[0].barFraction).toBe(1);
        rows.forEach((r) => {
          expect(r.barFraction).toBeGreaterThan(0);
          expect(r.barFraction).toBeLessThanOrEqual(1);
        });
      }),
    );
  });
});

describe("limitRows", () => {
  it("keeps the first `limit` rows, dropping the rest", () => {
    expect(limitRows(["a", "b", "c", "d"], 5)).toEqual(["a", "b", "c", "d"]);
    expect(limitRows(["a", "b", "c", "d"], 15)).toEqual(["a", "b", "c", "d"]);
    const rows = [1, 2, 3, 4, 5, 6, 7];
    expect(limitRows(rows, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("law: result length is min(limit, input length), and is always a prefix of the input", () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), fc.constantFrom(...ROW_LIMIT_OPTIONS), (rows, limit) => {
        const limited = limitRows(rows, limit);
        expect(limited.length).toBe(Math.min(limit, rows.length));
        expect(rows.slice(0, limited.length)).toEqual(limited);
      }),
    );
  });
});

describe("threadDisplayLabel", () => {
  it("prefers the BB thread title over everything else", () => {
    expect(threadDisplayLabel(thread({ bbThreadTitle: "Пайчарт", bbProjectName: "Demo" }))).toBe("Пайчарт");
  });

  it("falls back to the recovered BB project name plus a short session id when no thread matched", () => {
    expect(
      threadDisplayLabel(thread({ session: "abcdefghijkl", bbThreadTitle: null, bbProjectName: "Demo" })),
    ).toBe("Demo · abcdefgh");
  });

  it("falls back to a bare short session id when neither a thread nor a project matched", () => {
    expect(
      threadDisplayLabel(thread({ session: "abcdefghijkl", bbThreadTitle: null, bbProjectName: null })),
    ).toBe("abcdefgh");
  });
});

describe("donutArcs", () => {
  const CIRCUMFERENCE = 100;

  it("lays arcs head to tail, starting at zero", () => {
    const arcs = donutArcs([0.5, 0.25, 0.25], CIRCUMFERENCE);
    expect(arcs.map((a) => a.dash)).toEqual([50, 25, 25]);
    expect(arcs.map((a) => a.offset)).toEqual([0, -50, -75]);
    expect(arcs.map((a) => a.gap)).toEqual([50, 75, 75]);
  });

  it("draws a single full-circle arc without a degenerate gap", () => {
    const [arc] = donutArcs([1], CIRCUMFERENCE);
    expect(arc.dash).toBe(CIRCUMFERENCE);
    expect(arc.gap).toBe(0);
    expect(arc.offset).toBe(0);
  });

  it("clamps a later arc against what's LEFT of the circle, not its own share, when shares sum past 1", () => {
    // Two shares of 0.8 each: an unguarded caller would draw 160 units of
    // dash on a 100-unit circle, overlapping the first arc with the second.
    const arcs = donutArcs([0.8, 0.8], CIRCUMFERENCE);
    expect(arcs.map((a) => a.dash)).toEqual([80, 20]);
    expect(arcs.map((a) => a.gap)).toEqual([20, 80]);
  });

  it("reads a non-finite or negative share as zero instead of throwing or drawing a negative dash", () => {
    const arcs = donutArcs([Number.NaN, -1, 0.5], CIRCUMFERENCE);
    expect(arcs.map((a) => a.dash)).toEqual([0, 0, 50]);
    expect(arcs.map((a) => a.offset)).toEqual([0, 0, 0]);
  });

  it("law: arcs never overrun the circle and follow the input order", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 12 }), (raw) => {
        const sum = raw.reduce((a, b) => a + b, 0);
        const shares = sum === 0 ? raw.map(() => 0) : raw.map((v) => v / sum);
        const arcs = donutArcs(shares, CIRCUMFERENCE);
        expect(arcs).toHaveLength(shares.length);
        arcs.forEach((arc, i) => {
          expect(arc.dash).toBeGreaterThanOrEqual(0);
          expect(arc.dash).toBeLessThanOrEqual(CIRCUMFERENCE + 1e-9);
          expect(-arc.offset).toBeCloseTo(arcs.slice(0, i).reduce((sum2, a) => sum2 + a.dash, 0), 8);
        });
      }),
    );
  });

  it("law: total dash never exceeds the circumference, even for raw, unnormalized, or invalid shares", () => {
    const rawShareArb = fc.oneof(fc.double({ min: -2, max: 2, noNaN: true }), fc.constant(Number.NaN));
    fc.assert(
      fc.property(fc.array(rawShareArb, { maxLength: 12 }), (shares) => {
        const arcs = donutArcs(shares, CIRCUMFERENCE);
        const totalDash = arcs.reduce((sum, a) => sum + a.dash, 0);
        expect(totalDash).toBeLessThanOrEqual(CIRCUMFERENCE + 1e-9);
        arcs.forEach((a) => expect(a.dash).toBeGreaterThanOrEqual(0));
      }),
    );
  });
});

describe("allProjectKeys", () => {
  it("lists BB projects alphabetically, deduplicated, with the unmatched bucket last", () => {
    const threads = [
      thread({ bbProjectName: "Beta" }),
      thread({ bbProjectName: null }),
      thread({ bbProjectName: "Alpha" }),
      thread({ bbProjectName: "Alpha" }),
    ];
    expect(allProjectKeys(threads)).toEqual(["Alpha", "Beta", null]);
  });

  it("omits the unmatched bucket entirely when every thread has a BB project", () => {
    expect(allProjectKeys([thread({ bbProjectName: "Alpha" })])).toEqual(["Alpha"]);
  });

  it("returns an empty list for no threads", () => {
    expect(allProjectKeys([])).toEqual([]);
  });

  it("law: the order doesn't depend on the threads' own order (stable under shuffling)", () => {
    fc.assert(
      fc.property(fc.array(threadArb, { maxLength: 10 }), (threads) => {
        const shuffled = [...threads].reverse();
        expect(allProjectKeys(shuffled)).toEqual(allProjectKeys(threads));
      }),
    );
  });
});

describe("resolveProjectSelection", () => {
  it("passes an 'all' selection through unchanged", () => {
    expect(resolveProjectSelection({ kind: "all" }, [])).toEqual({ kind: "all" });
  });

  it("keeps a project selection that still has a slice in the window", () => {
    const slices = [{ key: "Alpha", label: "Alpha", cost: 5, share: 1 }];
    const selection: ProjectSelection = { kind: "project", key: "Alpha" };
    expect(resolveProjectSelection(selection, slices)).toEqual(selection);
  });

  it("falls back to 'all' when the selected project has no slice in the window (the window narrowed past it)", () => {
    const slices = [{ key: "Alpha", label: "Alpha", cost: 5, share: 1 }];
    expect(resolveProjectSelection({ kind: "project", key: "Beta" }, slices)).toEqual({ kind: "all" });
  });

  it("law: the resolved selection is always 'all', or a 'project' selection whose key has a matching slice", () => {
    const selectionArb = fc.oneof(
      fc.constant<ProjectSelection>({ kind: "all" }),
      fc.constantFrom<string | null>("Alpha", "Beta", null).map((key): ProjectSelection => ({ kind: "project", key })),
    );
    fc.assert(
      fc.property(fc.array(threadArb, { maxLength: 10 }), selectionArb, (threads, selection) => {
        const slices = projectCostSlices(threads, Number.NEGATIVE_INFINITY);
        const resolved = resolveProjectSelection(selection, slices);
        if (resolved.kind === "project") {
          expect(slices.some((s) => s.key === resolved.key)).toBe(true);
        }
      }),
    );
  });
});
