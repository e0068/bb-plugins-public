import { describe, expect, it } from "vitest";
import { bucketGitEventsByBin, computeDisplayBins, segmentContainsAgent, type DisplayBin } from "../pages/thread-chart";
import type { AgentBin, GitEvent, TimelineBin } from "../src/core";

describe("segmentContainsAgent", () => {
  it("matches a plain (non-workflow) segment by its own key", () => {
    const agent: AgentBin = { key: "main", total: 100 };
    expect(segmentContainsAgent(agent, "main")).toBe(true);
    expect(segmentContainsAgent(agent, "agent-abc")).toBe(false);
  });

  it("matches a workflow-merged segment by any of its members, not just its own key", () => {
    const agent: AgentBin = { key: "workflow:wf_1", total: 300, members: ["agent-x", "agent-y"] };
    expect(segmentContainsAgent(agent, "agent-x")).toBe(true);
    expect(segmentContainsAgent(agent, "agent-y")).toBe(true);
    expect(segmentContainsAgent(agent, "workflow:wf_1")).toBe(true);
    expect(segmentContainsAgent(agent, "agent-z")).toBe(false);
  });

  it("does not match anything for a workflow segment with no recorded members (defensive: schema allows the field to be absent)", () => {
    const agent: AgentBin = { key: "workflow:wf_1", total: 300 };
    expect(segmentContainsAgent(agent, "agent-x")).toBe(false);
  });
});

describe("computeDisplayBins", () => {
  const UNIT = 60; // seconds — 1-minute bins
  const active = (t: string): TimelineBin => ({ t, agents: [{ key: "main", total: 100 }] });
  const empty = (t: string): TimelineBin => ({ t, agents: [] });
  // Distinct t values only to keep fixtures readable — the folding logic keys off
  // emptiness and gapUnits, never the timestamp itself.
  const at = (n: number) => `2026-08-20T10:${String(n).padStart(2, "0")}:00.000Z`;
  const kinds = (columns: DisplayBin[]) => columns.map((c) => (c.bin === null ? `gap:${c.gapUnits}` : "bar"));

  const withGap = (gapLen: number): TimelineBin[] => [
    active(at(0)),
    ...Array.from({ length: gapLen }, (_, i) => empty(at(1 + i))),
    active(at(1 + gapLen)),
  ];

  it("collapseEmpty off, threshold 0 — 1:1 passthrough, every empty bin its own column", () => {
    expect(kinds(computeDisplayBins(withGap(3), false, UNIT, 0))).toEqual(["bar", "gap:1", "gap:1", "gap:1", "bar"]);
  });

  it("collapseEmpty on, threshold 0 — a run of empty bins folds into one gap column", () => {
    expect(kinds(computeDisplayBins(withGap(3), true, UNIT, 0))).toEqual(["bar", "gap:3", "bar"]);
  });

  it("collapseEmpty on, threshold 5min — a 3-minute gap (≤5) is dropped entirely, neighbours sit flush", () => {
    expect(kinds(computeDisplayBins(withGap(3), true, UNIT, 5))).toEqual(["bar", "bar"]);
  });

  it("collapseEmpty on, threshold 2min — a 3-minute gap (>2) keeps its collapsed column", () => {
    expect(kinds(computeDisplayBins(withGap(3), true, UNIT, 2))).toEqual(["bar", "gap:3", "bar"]);
  });

  it("drops a gap whose duration is exactly the threshold (≤ is inclusive)", () => {
    // 5 empty 1-minute bins = 300s; threshold 5min = 300s → dropped.
    expect(kinds(computeDisplayBins(withGap(5), true, UNIT, 5))).toEqual(["bar", "bar"]);
  });

  it("ignores the threshold when collapseEmpty is off (stage 2 is a refinement of stage 1)", () => {
    expect(kinds(computeDisplayBins(withGap(3), false, UNIT, 5))).toEqual(["bar", "gap:1", "gap:1", "gap:1", "bar"]);
  });

  it("drops only the short gaps, keeping the long one, when both appear in one thread", () => {
    const bins = [active(at(0)), empty(at(1)), empty(at(2)), active(at(3)), empty(at(4)), active(at(5))];
    // First gap: 2min (kept at threshold 1), second gap: 1min (dropped at threshold 1).
    expect(kinds(computeDisplayBins(bins, true, UNIT, 1))).toEqual(["bar", "gap:2", "bar", "bar"]);
  });

  it("treats a bin whose agents sum to zero as empty", () => {
    const bins = [active(at(0)), { t: at(1), agents: [{ key: "main", total: 0 }] }, active(at(2))];
    expect(kinds(computeDisplayBins(bins, true, UNIT, 5))).toEqual(["bar", "bar"]);
  });
});

describe("bucketGitEventsByBin", () => {
  const bin = (t: string, gapUnits = 1): DisplayBin => ({ t, gapUnits, bin: null });
  const commit = (ts: string): GitEvent => ({ type: "commit", ts, hash: "abc1234", message: "m", url: null });
  const UNIT = 60; // seconds

  it("returns one (possibly empty) array per display bin, index-aligned", () => {
    const bins = [bin("2026-08-20T10:00:00.000Z"), bin("2026-08-20T10:01:00.000Z")];
    expect(bucketGitEventsByBin(bins, [], UNIT)).toEqual([[], []]);
  });

  it("places an event in the bin whose [t, t+unit) window contains its ts", () => {
    const bins = [bin("2026-08-20T10:00:00.000Z"), bin("2026-08-20T10:01:00.000Z")];
    const event = commit("2026-08-20T10:01:30.000Z");
    expect(bucketGitEventsByBin(bins, [event], UNIT)).toEqual([[], [event]]);
  });

  it("includes an event exactly at a bin's start (inclusive lower bound)", () => {
    const bins = [bin("2026-08-20T10:00:00.000Z")];
    const event = commit("2026-08-20T10:00:00.000Z");
    expect(bucketGitEventsByBin(bins, [event], UNIT)).toEqual([[event]]);
  });

  it("excludes an event exactly at a bin's end (exclusive upper bound — it belongs to the NEXT bin)", () => {
    const bins = [bin("2026-08-20T10:00:00.000Z"), bin("2026-08-20T10:01:00.000Z")];
    const event = commit("2026-08-20T10:01:00.000Z");
    expect(bucketGitEventsByBin(bins, [event], UNIT)).toEqual([[], [event]]);
  });

  it("widens the window by gapUnits for a collapsed gap column", () => {
    const bins = [bin("2026-08-20T10:00:00.000Z", 3)]; // covers 3 raw units = 180s
    const event = commit("2026-08-20T10:02:30.000Z"); // 150s in, still inside
    expect(bucketGitEventsByBin(bins, [event], UNIT)).toEqual([[event]]);
  });

  it("collects multiple events into the same bin, preserving their order", () => {
    const bins = [bin("2026-08-20T10:00:00.000Z")];
    const first = commit("2026-08-20T10:00:10.000Z");
    const second = commit("2026-08-20T10:00:20.000Z");
    expect(bucketGitEventsByBin(bins, [first, second], UNIT)).toEqual([[first, second]]);
  });

  it("drops an event with an unparseable ts instead of throwing", () => {
    const bins = [bin("2026-08-20T10:00:00.000Z")];
    const event = commit("not-a-date");
    expect(bucketGitEventsByBin(bins, [event], UNIT)).toEqual([[]]);
  });
});
