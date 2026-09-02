import { describe, expect, it } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { EXPECTED_AGENT_TIMELINE_SCHEMA_VERSION } from "../../core/agent-timeline";
import { createAgentTimelineRunner, createAgentTimelineService } from "../agent-timeline-service";
import type { ProcessRunner, ProcessRunResult } from "../process-runner";

// This service doesn't call out to bb.sdk (see the factory's own doc
// comment) — an empty stub is enough to satisfy the parameter.
const fakeBb = {} as BbPluginApi;

const VALID_STDOUT = JSON.stringify({
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
});

function fakeRunner(impl: (command: string, args: readonly string[]) => Promise<ProcessRunResult> | ProcessRunResult) {
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner: ProcessRunner = async (command, args) => {
    calls.push({ command, args });
    return impl(command, args);
  };
  return { runner, calls };
}

describe("createAgentTimelineRunner", () => {
  it("builds args from session + agent, plus --json and the script path", async () => {
    const { runner, calls } = fakeRunner(() => ({ ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 }));
    const timelineRunner = createAgentTimelineRunner({ processRunner: runner, scriptPath: "/plugin/tools/agent_timeline.py" });

    await timelineRunner.run({ session: "sess-1", agent: "agent-abc" });
    expect(calls[0].args).toEqual([
      "/plugin/tools/agent_timeline.py",
      "--json",
      "--session",
      "sess-1",
      "--agent",
      "agent-abc",
    ]);
  });

  it("omits --agent when not provided (script defaults to main)", async () => {
    const { runner, calls } = fakeRunner(() => ({ ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 }));
    const timelineRunner = createAgentTimelineRunner({ processRunner: runner, scriptPath: "/plugin/tools/agent_timeline.py" });

    await timelineRunner.run({ session: "sess-1" });
    expect(calls[0].args).toEqual(["/plugin/tools/agent_timeline.py", "--json", "--session", "sess-1"]);
  });

  it("parses a successful run's stdout into an AgentTimeline", async () => {
    const { runner } = fakeRunner(() => ({ ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 }));
    const timelineRunner = createAgentTimelineRunner({ processRunner: runner });

    const result = await timelineRunner.run({ session: "sess-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.agent.key).toBe("main");
  });

  it("rejects an empty-string session before spawning a process", async () => {
    const { runner, calls } = fakeRunner(() => ({ ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 }));
    const timelineRunner = createAgentTimelineRunner({ processRunner: runner });

    const result = await timelineRunner.run({ session: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_session");
    expect(calls).toHaveLength(0);
  });

  it("reports python_not_found when neither python3 nor python resolves", async () => {
    const { runner, calls } = fakeRunner(() => ({ ok: false, reason: "not_found", message: "nope" }));
    const timelineRunner = createAgentTimelineRunner({ processRunner: runner });

    const result = await timelineRunner.run({ session: "sess-1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("python_not_found");
    expect(calls.map((c) => c.command)).toEqual(["python3", "python"]);
  });

  it("recognizes the script's own {error: ...} envelope as script_error", async () => {
    const { runner } = fakeRunner(() => ({
      ok: true,
      stdout: JSON.stringify({ error: "Session not found: 'x'" }),
      stderr: "",
      code: 1,
    }));
    const timelineRunner = createAgentTimelineRunner({ processRunner: runner });

    const result = await timelineRunner.run({ session: "sess-1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("script_error");
    expect(result.message).toBe("Session not found: 'x'");
  });

  it("treats non-JSON garbage on stdout as invalid_output, not a thrown error", async () => {
    const { runner } = fakeRunner(() => ({ ok: true, stdout: "not json {{{", stderr: "", code: 0 }));
    const timelineRunner = createAgentTimelineRunner({ processRunner: runner });

    const result = await timelineRunner.run({ session: "sess-1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_output");
  });

  it("folds stderr and exit code into the message when stdout was empty", async () => {
    const { runner } = fakeRunner(() => ({
      ok: true,
      stdout: "",
      stderr: "python3: can't open file 'tools/agent_timeline.py'\n",
      code: 2,
    }));
    const timelineRunner = createAgentTimelineRunner({ processRunner: runner });

    const result = await timelineRunner.run({ session: "sess-1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_output");
    expect(result.message).toContain("exit code 2");
    expect(result.message).toContain("agent_timeline.py");
  });
});

describe("createAgentTimelineService", () => {
  it("serves the second identical (session, agent) query from cache without recomputing", async () => {
    let calls = 0;
    const { runner } = fakeRunner(() => {
      calls++;
      return { ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 };
    });
    const service = createAgentTimelineService(fakeBb, { processRunner: runner });

    await service.query({ session: "sess-1", agent: "main" });
    await service.query({ session: "sess-1", agent: "main" });

    expect(calls).toBe(1);
  });

  it("treats an omitted agent the same as agent: 'main' for cache purposes", async () => {
    let calls = 0;
    const { runner } = fakeRunner(() => {
      calls++;
      return { ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 };
    });
    const service = createAgentTimelineService(fakeBb, { processRunner: runner });

    await service.query({ session: "sess-1" });
    await service.query({ session: "sess-1", agent: "main" });

    expect(calls).toBe(1);
  });

  it("keeps different agents within the same session in independent cache entries", async () => {
    let calls = 0;
    const { runner } = fakeRunner(() => {
      calls++;
      return { ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 };
    });
    const service = createAgentTimelineService(fakeBb, { processRunner: runner });

    await service.query({ session: "sess-1", agent: "main" });
    await service.query({ session: "sess-1", agent: "agent-abc" });

    expect(calls).toBe(2);
  });

  it("does not cache a failed run — the next query recomputes", async () => {
    // "timeout" (unlike "not_found") never falls back to the other
    // interpreter — see tokens-runner.ts's mapProcessFailure — so the first
    // query fails after exactly one spawn, and the second (cache miss,
    // since the failure wasn't cached) gets a fresh attempt.
    const results: ProcessRunResult[] = [
      { ok: false, reason: "timeout", message: "timed out" },
      { ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 },
    ];
    let calls = 0;
    const { runner } = fakeRunner(() => results[calls++] ?? results[results.length - 1]);
    const service = createAgentTimelineService(fakeBb, { processRunner: runner });

    const first = await service.query({ session: "sess-1" });
    expect(first.ok).toBe(false);
    expect(calls).toBe(1);

    const second = await service.query({ session: "sess-1" });
    expect(second.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it("recomputes once the TTL has elapsed", async () => {
    let calls = 0;
    const { runner } = fakeRunner(() => {
      calls++;
      return { ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 };
    });
    let now = 0;
    const service = createAgentTimelineService(fakeBb, { processRunner: runner, cacheTtlMs: 1_000, now: () => now });

    await service.query({ session: "sess-1" });
    now = 1_001;
    await service.query({ session: "sess-1" });

    expect(calls).toBe(2);
  });

  it("clearCache() forces the next query to recompute", async () => {
    let calls = 0;
    const { runner } = fakeRunner(() => {
      calls++;
      return { ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 };
    });
    const service = createAgentTimelineService(fakeBb, { processRunner: runner });

    await service.query({ session: "sess-1" });
    service.clearCache();
    await service.query({ session: "sess-1" });

    expect(calls).toBe(2);
  });
});

function stdoutWithPrNumbers(...prNumbers: { number: number; repository: string }[]) {
  return JSON.stringify({
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
    prNumbers,
  });
}

describe("createAgentTimelineService: merge status", () => {
  it("turns a MERGED PR into a merge event", async () => {
    const scriptStdout = stdoutWithPrNumbers({ number: 73, repository: "e0068/bb-plugins" });
    const { runner } = fakeRunner((command) => {
      if (command === "gh") {
        return {
          ok: true,
          stdout: JSON.stringify({ state: "MERGED", url: "https://github.com/e0068/bb-plugins/pull/73", mergedAt: "2026-08-27T00:10:00Z" }),
          stderr: "",
          code: 0,
        };
      }
      return { ok: true, stdout: scriptStdout, stderr: "", code: 0 };
    });
    const service = createAgentTimelineService(fakeBb, { processRunner: runner });

    const result = await service.query({ session: "sess-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.mergeEvents).toEqual([
      { type: "merge", ts: "2026-08-27T00:10:00Z", number: 73, url: "https://github.com/e0068/bb-plugins/pull/73", repository: "e0068/bb-plugins" },
    ]);
  });

  it("produces no merge event for an open PR", async () => {
    const scriptStdout = stdoutWithPrNumbers({ number: 73, repository: "e0068/bb-plugins" });
    const { runner } = fakeRunner((command) => {
      if (command === "gh") {
        return { ok: true, stdout: JSON.stringify({ state: "OPEN", url: "u", mergedAt: null }), stderr: "", code: 0 };
      }
      return { ok: true, stdout: scriptStdout, stderr: "", code: 0 };
    });
    const service = createAgentTimelineService(fakeBb, { processRunner: runner });

    const result = await service.query({ session: "sess-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.mergeEvents).toEqual([]);
  });

  it("resolves multiple PRs in parallel, one merge event per merged PR", async () => {
    const scriptStdout = stdoutWithPrNumbers({ number: 73, repository: "e0068/bb-plugins" }, { number: 10, repository: "e0068/bb-plugins" });
    const { runner } = fakeRunner((command, args) => {
      if (command === "gh") {
        const number = args[2];
        const merged = number === "73";
        return {
          ok: true,
          stdout: JSON.stringify({ state: merged ? "MERGED" : "CLOSED", url: `https://github.com/e0068/bb-plugins/pull/${number}`, mergedAt: merged ? "2026-08-27T00:10:00Z" : null }),
          stderr: "",
          code: 0,
        };
      }
      return { ok: true, stdout: scriptStdout, stderr: "", code: 0 };
    });
    const service = createAgentTimelineService(fakeBb, { processRunner: runner });

    const result = await service.query({ session: "sess-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.mergeEvents).toEqual([
      { type: "merge", ts: "2026-08-27T00:10:00Z", number: 73, url: "https://github.com/e0068/bb-plugins/pull/73", repository: "e0068/bb-plugins" },
    ]);
  });

  it("does not call `gh` at all when the session references no PR", async () => {
    const scriptStdout = stdoutWithPrNumbers();
    const { runner, calls } = fakeRunner(() => ({ ok: true, stdout: scriptStdout, stderr: "", code: 0 }));
    const service = createAgentTimelineService(fakeBb, { processRunner: runner });

    const result = await service.query({ session: "sess-1" });

    expect(result.ok).toBe(true);
    expect(calls.some((c) => c.command === "gh")).toBe(false);
  });

  it("leaves mergeEvents empty (but doesn't fail the query) when `gh` isn't installed", async () => {
    const scriptStdout = stdoutWithPrNumbers({ number: 73, repository: "e0068/bb-plugins" });
    const { runner } = fakeRunner((command) => {
      if (command === "gh") return { ok: false, reason: "not_found", message: '"gh" not found in PATH' };
      return { ok: true, stdout: scriptStdout, stderr: "", code: 0 };
    });
    const service = createAgentTimelineService(fakeBb, { processRunner: runner });

    const result = await service.query({ session: "sess-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.mergeEvents).toEqual([]);
  });
});
