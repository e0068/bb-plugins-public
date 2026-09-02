import { describe, expect, it } from "vitest";
import { EXPECTED_AGENT_TIMELINE_SCHEMA_VERSION, formatEventLabel, parseAgentTimeline } from "../agent-timeline";

const validTimeline = {
  schemaVersion: EXPECTED_AGENT_TIMELINE_SCHEMA_VERSION,
  agent: {
    key: "agent-a9e92d5bea00f5cb7",
    agentType: "general-purpose",
    description: "Review the diff",
    model: "sonnet",
    spawnDepth: 1,
    promptExcerpt: "Please review the diff carefully",
    requestFull: "Please review the diff carefully",
    requestFullTruncated: false,
    responseFull: "Looks good",
    responseFullTruncated: false,
  },
  events: [
    {
      ts: "2026-08-20T14:40:00.000Z",
      kind: "message",
      role: "user",
      text: "Please review the diff carefully",
      fullText: "Please review the diff carefully",
      fullTextTruncated: false,
    },
    { ts: "2026-08-20T14:40:01.000Z", kind: "tool", name: "Read", target: "/repo/file.ts" },
    { ts: "2026-08-20T14:40:02.000Z", kind: "hook", hookName: "PostToolUse", hookEvent: "PostToolUse" },
    {
      ts: "2026-08-20T14:40:03.000Z",
      kind: "message",
      role: "assistant",
      text: "Looks good",
      fullText: "Looks good",
      fullTextTruncated: false,
    },
  ],
  prNumbers: [{ number: 73, repository: "e0068/bb-plugins" }],
};

describe("parseAgentTimeline", () => {
  it("parses a valid timeline with all three event kinds", () => {
    const result = parseAgentTimeline(JSON.stringify(validTimeline));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.agent.key).toBe("agent-a9e92d5bea00f5cb7");
    expect(result.data.events).toHaveLength(4);
    expect(result.data.events[1]).toEqual({
      ts: "2026-08-20T14:40:01.000Z",
      kind: "tool",
      name: "Read",
      target: "/repo/file.ts",
    });
  });

  it("defaults mergeEvents to [] — the script never sends it, only the service layer fills it in", () => {
    const result = parseAgentTimeline(JSON.stringify(validTimeline));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.mergeEvents).toEqual([]);
  });

  it("carries prNumbers through as-is", () => {
    const result = parseAgentTimeline(JSON.stringify(validTimeline));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.prNumbers).toEqual([{ number: 73, repository: "e0068/bb-plugins" }]);
  });

  it("accepts an empty prNumbers list", () => {
    const timeline = { ...validTimeline, prNumbers: [] };
    const result = parseAgentTimeline(JSON.stringify(timeline));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.prNumbers).toEqual([]);
  });

  it("parses the main agent's info with null fields", () => {
    const mainTimeline = {
      schemaVersion: EXPECTED_AGENT_TIMELINE_SCHEMA_VERSION,
      agent: {
        key: "main",
        agentType: null,
        description: null,
        model: null,
        spawnDepth: null,
        promptExcerpt: null,
        requestFull: null,
        requestFullTruncated: false,
        responseFull: null,
        responseFullTruncated: false,
      },
      events: [],
      prNumbers: [],
    };
    const result = parseAgentTimeline(JSON.stringify(mainTimeline));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.agent.key).toBe("main");
    expect(result.data.events).toEqual([]);
  });

  it("fails on empty output", () => {
    const result = parseAgentTimeline("");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_json");
  });

  it("fails on non-JSON garbage", () => {
    const result = parseAgentTimeline("not json {{{");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_json");
  });

  it("recognizes the script's own {error: ...} envelope as script_error", () => {
    const result = parseAgentTimeline(JSON.stringify({ error: "Session not found: 'x'" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("script_error");
    expect(result.message).toBe("Session not found: 'x'");
  });

  it("fails on a schema version mismatch, reported before any shape errors", () => {
    const result = parseAgentTimeline(JSON.stringify({ ...validTimeline, schemaVersion: 999 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("schema_version_mismatch");
    expect(result.message).toContain("999");
  });

  it("fails on a missing schema version field", () => {
    const { schemaVersion: _drop, ...rest } = validTimeline;
    const result = parseAgentTimeline(JSON.stringify(rest));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("schema_version_mismatch");
  });

  it("parses an assistant message carrying tokens/cost", () => {
    const timeline = {
      ...validTimeline,
      events: [
        {
          ts: "2026-08-20T14:40:03.000Z",
          kind: "message",
          role: "assistant",
          text: "Looks good",
          fullText: "Looks good",
          fullTextTruncated: false,
          tokens: 150,
          cost: 0.03,
        },
      ],
    };
    const result = parseAgentTimeline(JSON.stringify(timeline));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const event = result.data.events[0];
    expect(event.kind).toBe("message");
    if (event.kind !== "message") return;
    expect(event.tokens).toBe(150);
    expect(event.cost).toBe(0.03);
  });

  it("parses a user message without tokens/cost fields", () => {
    const timeline = {
      ...validTimeline,
      events: [
        { ts: "2026-08-20T14:40:00.000Z", kind: "message", role: "user", text: "hi", fullText: "hi", fullTextTruncated: false },
      ],
    };
    const result = parseAgentTimeline(JSON.stringify(timeline));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const event = result.data.events[0];
    expect(event.kind).toBe("message");
    if (event.kind !== "message") return;
    expect(event.tokens).toBeUndefined();
    expect(event.cost).toBeUndefined();
  });

  it("fails on an unknown event kind", () => {
    const broken = {
      ...validTimeline,
      events: [{ ts: "2026-08-20T14:40:00.000Z", kind: "unknown-kind" }],
    };
    const result = parseAgentTimeline(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_shape");
  });

  it("fails on a bucket missing a required field (strict shape)", () => {
    const broken = {
      ...validTimeline,
      agent: {
        key: "main",
        agentType: null,
        description: null,
        model: null,
        spawnDepth: null,
        // promptExcerpt intentionally missing
      },
    };
    const result = parseAgentTimeline(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_shape");
  });

  it("fails on an extra, unrecognized top-level field (strict)", () => {
    const broken = { ...validTimeline, unexpected: true };
    const result = parseAgentTimeline(JSON.stringify(broken));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_shape");
  });

  it("fails when the top level is not a JSON object", () => {
    const result = parseAgentTimeline(JSON.stringify([1, 2, 3]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_shape");
  });
});

describe("formatEventLabel", () => {
  it("formats a tool event with a target", () => {
    const label = formatEventLabel({ ts: "t", kind: "tool", name: "Read", target: "/repo/file.ts" });
    expect(label).toBe("Tool Read: /repo/file.ts");
  });

  it("formats a tool event without a target", () => {
    const label = formatEventLabel({ ts: "t", kind: "tool", name: "Glob", target: null });
    expect(label).toBe("Tool Glob");
  });

  it("formats a hook event", () => {
    const label = formatEventLabel({ ts: "t", kind: "hook", hookName: "SessionStart:startup", hookEvent: "SessionStart" });
    expect(label).toBe("Hook SessionStart:startup (SessionStart)");
  });

  it("formats a user message event", () => {
    const label = formatEventLabel({ ts: "t", kind: "message", role: "user", text: "Do the thing", fullText: "Do the thing", fullTextTruncated: false });
    expect(label).toBe("User: Do the thing");
  });

  it("formats an assistant message event", () => {
    const label = formatEventLabel({ ts: "t", kind: "message", role: "assistant", text: "Done", fullText: "Done", fullTextTruncated: false });
    expect(label).toBe("Assistant: Done");
  });

  it("formats an assistant message event with cost", () => {
    const label = formatEventLabel({
      ts: "t",
      kind: "message",
      role: "assistant",
      text: "Done",
      fullText: "Done",
      fullTextTruncated: false,
      tokens: 150,
      cost: 0.03,
    });
    expect(label).toBe("Assistant ($0.03): Done");
  });

  it("formats a user message event without a cost suffix even though the field could be present", () => {
    const label = formatEventLabel({ ts: "t", kind: "message", role: "user", text: "Do the thing", fullText: "Do the thing", fullTextTruncated: false });
    expect(label).toBe("User: Do the thing");
  });

  it("truncates a long label to maxLength", () => {
    const longTarget = "x".repeat(200);
    const label = formatEventLabel({ ts: "t", kind: "tool", name: "Bash", target: longTarget }, 20);
    expect(label.length).toBe(20);
    expect(label.endsWith("…")).toBe(true);
  });
});
