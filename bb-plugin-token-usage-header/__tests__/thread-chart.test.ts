import { describe, expect, it } from "vitest";
import { bucketGitEventsByBin, resolveWorkflowClickTarget, segmentContainsAgent, type DisplayBin } from "../pages/thread-chart";
import type { AgentBin, GitEvent } from "../src/core";

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

describe("resolveWorkflowClickTarget", () => {
  const agent: AgentBin = { key: "workflow:wf_1", total: 300, members: ["agent-x", "agent-y"] };

  it("prefers the active agent when it is one of the workflow's members", () => {
    expect(resolveWorkflowClickTarget(agent, "agent-y")).toBe("agent-y");
  });

  it("falls back to the first member when there is no active agent", () => {
    expect(resolveWorkflowClickTarget(agent, null)).toBe("agent-x");
    expect(resolveWorkflowClickTarget(agent, undefined)).toBe("agent-x");
  });

  it("falls back to the first member when the active agent took no part in this workflow run", () => {
    expect(resolveWorkflowClickTarget(agent, "main")).toBe("agent-x");
  });

  it("has nowhere to send the click when the segment carries no members (pre-SCHEMA_VERSION-4 data)", () => {
    const noMembers: AgentBin = { key: "workflow:wf_1", total: 300 };
    expect(resolveWorkflowClickTarget(noMembers, "agent-x")).toBeNull();
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
