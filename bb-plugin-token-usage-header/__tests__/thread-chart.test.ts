import { describe, expect, it } from "vitest";
import { segmentContainsAgent } from "../pages/thread-chart";
import type { AgentBin } from "../src/core";

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
    // The workflow key itself is never a selectable agent (see ThreadRow's
    // onSegmentClick guard), but exact-key matching still holds if ever compared.
    expect(segmentContainsAgent(agent, "workflow:wf_1")).toBe(true);
    expect(segmentContainsAgent(agent, "agent-z")).toBe(false);
  });

  it("does not match anything for a workflow segment with no recorded members (defensive: schema allows the field to be absent)", () => {
    const agent: AgentBin = { key: "workflow:wf_1", total: 300 };
    expect(segmentContainsAgent(agent, "agent-x")).toBe(false);
  });
});
