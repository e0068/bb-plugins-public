// Tests the mapping/caching logic in createThreadsTimelineRunner and
// createThreadsTimelineService with an injected fake ProcessRunner — no real
// python/process involved. Mirrors src/service/__tests__/tokens-runner.test.ts
// and cache.test.ts's structure for the sibling contract.
import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import {
  createThreadsTimelineRunner,
  createThreadsTimelineService,
  defaultThreadsTimelineScriptPath,
  resolveThreadsTimelinePluginRoot,
  threadsTimelineCacheKey,
} from "../threads-timeline-service";
import type { ProcessRunner, ProcessRunResult } from "../process-runner";
import { EXPECTED_THREADS_TIMELINE_SCHEMA_VERSION } from "../../core/threads-timeline";

const VALID_STDOUT = JSON.stringify({
  schemaVersion: EXPECTED_THREADS_TIMELINE_SCHEMA_VERSION,
  unit: 300,
  threads: [],
  agentLabels: {},
});

/** One thread entry as threads_timeline.py --json prints it — pre-enrichment, no BB fields yet. */
function rawThread(session: string) {
  return {
    session,
    project: `-Users-e0068-Documents-Projects-${session}`,
    title: session,
    start: "2026-08-20T13:44:51.138Z",
    end: "2026-08-20T14:46:48.357Z",
    durationSec: 3717,
    totalTokens: 100,
    bins: [],
  };
}

function stdoutWithThreads(...sessions: string[]) {
  return JSON.stringify({
    schemaVersion: EXPECTED_THREADS_TIMELINE_SCHEMA_VERSION,
    unit: 300,
    threads: sessions.map(rawThread),
    agentLabels: {},
  });
}

/** Stubs a thread/identity event for the fake host's threads.events.list, same shape as thread-session.test.ts. */
function identityEvent(threadId: string, providerThreadId: string) {
  return {
    id: `evt-${threadId}`,
    scope: { kind: "thread" as const },
    threadId,
    seq: 1,
    createdAt: Date.now(),
    type: "thread/identity" as const,
    data: { providerThreadId },
  };
}

function fakeRunner(impl: (command: string, args: readonly string[]) => Promise<ProcessRunResult> | ProcessRunResult) {
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner: ProcessRunner = async (command, args) => {
    calls.push({ command, args });
    return impl(command, args);
  };
  return { runner, calls };
}

// createThreadsTimelineService accepts a BbPluginApi for signature symmetry
// but doesn't touch it yet — an empty stub is enough for every test here.
const fakeBb = {} as BbPluginApi;

describe("defaultThreadsTimelineScriptPath", () => {
  it("resolves to an actual file on disk from this module's real location", () => {
    const path = defaultThreadsTimelineScriptPath();
    expect(existsSync(path)).toBe(true);
    expect(path.endsWith("tools/threads_timeline.py") || path.endsWith("tools\\threads_timeline.py")).toBe(true);
  });
});

describe("resolveThreadsTimelinePluginRoot", () => {
  it("finds the plugin root by walking up from a source-layout module", () => {
    const exists = (p: string) => p === "/plugin/tools/threads_timeline.py";
    const root = resolveThreadsTimelinePluginRoot("/plugin/src/service", exists);
    expect(root).toBe("/plugin");
  });

  it("returns null when no ancestor directory has tools/threads_timeline.py", () => {
    const root = resolveThreadsTimelinePluginRoot("/somewhere/deep/nested/dir", () => false);
    expect(root).toBeNull();
  });
});

describe("createThreadsTimelineRunner: argument building", () => {
  it("passes --json, --unit, and the script path for a bare unit-only query", async () => {
    const { runner, calls } = fakeRunner(() => ({ ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 }));
    const timelineRunner = createThreadsTimelineRunner({ processRunner: runner, scriptPath: "/plugin/tools/threads_timeline.py" });

    await timelineRunner.run({ unit: 300 });
    expect(calls[0].args).toEqual(["/plugin/tools/threads_timeline.py", "--json", "--unit", "300"]);
  });

  it("appends --limit and --project when provided", async () => {
    const { runner, calls } = fakeRunner(() => ({ ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 }));
    const timelineRunner = createThreadsTimelineRunner({ processRunner: runner, scriptPath: "/plugin/tools/threads_timeline.py" });

    await timelineRunner.run({ unit: 60, limit: 5, project: "bb-plugins" });
    expect(calls[0].args).toEqual([
      "/plugin/tools/threads_timeline.py",
      "--json",
      "--unit",
      "60",
      "--limit",
      "5",
      "--project",
      "bb-plugins",
    ]);
  });
});

describe("createThreadsTimelineRunner: validation", () => {
  it("rejects a non-positive unit without spawning a process", async () => {
    const { runner, calls } = fakeRunner(() => ({ ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 }));
    const timelineRunner = createThreadsTimelineRunner({ processRunner: runner });

    const result = await timelineRunner.run({ unit: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_params");
    expect(calls).toHaveLength(0);
  });

  it("rejects a negative limit without spawning a process", async () => {
    const { runner, calls } = fakeRunner(() => ({ ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 }));
    const timelineRunner = createThreadsTimelineRunner({ processRunner: runner });

    const result = await timelineRunner.run({ unit: 60, limit: -1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_params");
    expect(calls).toHaveLength(0);
  });
});

describe("createThreadsTimelineRunner: success and failure mapping", () => {
  it("parses a successful run's stdout into a timeline", async () => {
    const { runner } = fakeRunner(() => ({ ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 }));
    const timelineRunner = createThreadsTimelineRunner({ processRunner: runner, scriptPath: "/plugin/tools/threads_timeline.py" });

    const result = await timelineRunner.run({ unit: 300 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.threads).toEqual([]);
  });

  it("reports python_not_found when neither python3 nor python resolves", async () => {
    const { runner, calls } = fakeRunner(() => ({ ok: false, reason: "not_found", message: "nope" }));
    const timelineRunner = createThreadsTimelineRunner({ processRunner: runner });

    const result = await timelineRunner.run({ unit: 300 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("python_not_found");
    expect(calls.map((c) => c.command)).toEqual(["python3", "python"]);
  });

  it("falls back from python3 to python and remembers the working interpreter", async () => {
    const { runner, calls } = fakeRunner((command) =>
      command === "python3"
        ? { ok: false, reason: "not_found", message: "no python3" }
        : { ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 },
    );
    const timelineRunner = createThreadsTimelineRunner({ processRunner: runner });

    const first = await timelineRunner.run({ unit: 300 });
    expect(first.ok).toBe(true);
    expect(calls.map((c) => c.command)).toEqual(["python3", "python"]);

    calls.length = 0;
    const second = await timelineRunner.run({ unit: 300 });
    expect(second.ok).toBe(true);
    expect(calls.map((c) => c.command)).toEqual(["python"]);
  });

  it("recognizes the script's own {error: ...} envelope as script_error", async () => {
    const { runner } = fakeRunner(() => ({
      ok: true,
      stdout: JSON.stringify({ error: "boom: transcript directory missing" }),
      stderr: "",
      code: 1,
    }));
    const timelineRunner = createThreadsTimelineRunner({ processRunner: runner });

    const result = await timelineRunner.run({ unit: 300 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("script_error");
    expect(result.message).toBe("boom: transcript directory missing");
  });

  it("treats non-JSON garbage on stdout as invalid_output, folding in stderr and exit code", async () => {
    const { runner } = fakeRunner(() => ({
      ok: true,
      stdout: "",
      stderr: "python3: can't open file 'tools/threads_timeline.py': [Errno 2] No such file or directory\n",
      code: 2,
    }));
    const timelineRunner = createThreadsTimelineRunner({ processRunner: runner });

    const result = await timelineRunner.run({ unit: 300 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_output");
    expect(result.message).toContain("empty output");
    expect(result.message).toContain("код завершения 2");
    expect(result.message).toContain("No such file or directory");
  });

  it("maps a timeout without retrying the other interpreter", async () => {
    const { runner, calls } = fakeRunner(() => ({ ok: false, reason: "timeout", message: "timed out" }));
    const timelineRunner = createThreadsTimelineRunner({ processRunner: runner });

    const result = await timelineRunner.run({ unit: 300 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("timeout");
    expect(calls).toHaveLength(1);
  });
});

describe("threadsTimelineCacheKey", () => {
  it("normalizes missing optional fields the same as explicit defaults", () => {
    expect(threadsTimelineCacheKey({ unit: 300 })).toBe(threadsTimelineCacheKey({ unit: 300, limit: 20 }));
  });

  it("differs when unit, limit, or project differ", () => {
    const base = threadsTimelineCacheKey({ unit: 300 });
    expect(threadsTimelineCacheKey({ unit: 60 })).not.toBe(base);
    expect(threadsTimelineCacheKey({ unit: 300, limit: 5 })).not.toBe(base);
    expect(threadsTimelineCacheKey({ unit: 300, project: "bb-plugins" })).not.toBe(base);
  });
});

describe("createThreadsTimelineService", () => {
  it("serves an identical query from cache within the TTL, without spawning a second process", async () => {
    const { runner, calls } = fakeRunner(() => ({ ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 }));
    let now = 0;
    const service = createThreadsTimelineService(fakeBb, {
      processRunner: runner,
      scriptPath: "/plugin/tools/threads_timeline.py",
      now: () => now,
    });

    const first = await service.query({ unit: 300 });
    const second = await service.query({ unit: 300 });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("re-runs once the TTL has expired", async () => {
    const { runner, calls } = fakeRunner(() => ({ ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 }));
    let now = 0;
    const service = createThreadsTimelineService(fakeBb, {
      processRunner: runner,
      cacheTtlMs: 1000,
      now: () => now,
    });

    await service.query({ unit: 300 });
    now = 2000;
    await service.query({ unit: 300 });
    expect(calls).toHaveLength(2);
  });

  it("treats different params as different cache entries", async () => {
    const { runner, calls } = fakeRunner(() => ({ ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 }));
    const service = createThreadsTimelineService(fakeBb, { processRunner: runner });

    await service.query({ unit: 300 });
    await service.query({ unit: 60 });
    expect(calls).toHaveLength(2);
  });

  it("does not cache a failed run — the next query retries", async () => {
    // "timeout" (unlike "not_found") doesn't trigger a same-call fallback to
    // the other interpreter, so exactly one process call per query here.
    const { runner, calls } = fakeRunner(() => ({ ok: false, reason: "timeout", message: "timed out" }));
    const service = createThreadsTimelineService(fakeBb, { processRunner: runner });

    const first = await service.query({ unit: 300 });
    const second = await service.query({ unit: 300 });
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it("clearCache drops cached entries so the next query re-runs", async () => {
    const { runner, calls } = fakeRunner(() => ({ ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 }));
    const service = createThreadsTimelineService(fakeBb, { processRunner: runner });

    await service.query({ unit: 300 });
    service.clearCache();
    await service.query({ unit: 300 });
    expect(calls).toHaveLength(2);
  });

  it("shares one in-flight run across concurrent identical queries", async () => {
    let resolveRun: (value: ProcessRunResult) => void = () => {};
    const runner: ProcessRunner = vi.fn(
      () =>
        new Promise<ProcessRunResult>((resolve) => {
          resolveRun = resolve;
        }),
    );
    const service = createThreadsTimelineService(fakeBb, { processRunner: runner });

    const p1 = service.query({ unit: 300 });
    const p2 = service.query({ unit: 300 });
    resolveRun({ ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(runner).toHaveBeenCalledTimes(1);
  });
});

describe("createThreadsTimelineService: BB project enrichment", () => {
  it("tags a thread whose session matches a scanned BB thread's identity with its project", async () => {
    const { bb, harness } = createFakePluginHost();
    harness.sdk.stub("threads.list", async () => [{ id: "thread-1", projectId: "proj-1", title: "Design review" }]);
    harness.sdk.stub("threads.events.list", async ({ threadId }: { threadId: string }) =>
      threadId === "thread-1" ? [identityEvent("thread-1", "sess-1")] : [],
    );
    harness.sdk.stub("projects.list", async () => [{ id: "proj-1", name: "bb-plugins" }]);
    const { runner } = fakeRunner(() => ({ ok: true, stdout: stdoutWithThreads("sess-1"), stderr: "", code: 0 }));
    const service = createThreadsTimelineService(bb, { processRunner: runner });

    const result = await service.query({ unit: 300 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.threads).toEqual([
      expect.objectContaining({
        session: "sess-1",
        bbProjectId: "proj-1",
        bbProjectName: "bb-plugins",
        threadId: "thread-1",
        bbThreadTitle: "Design review",
      }),
    ]);
  });

  it("falls back to titleFallback when the matched BB thread's title is null", async () => {
    const { bb, harness } = createFakePluginHost();
    harness.sdk.stub("threads.list", async () => [
      { id: "thread-1", projectId: "proj-1", title: null, titleFallback: "Untitled session notes" },
    ]);
    harness.sdk.stub("threads.events.list", async () => [identityEvent("thread-1", "sess-1")]);
    harness.sdk.stub("projects.list", async () => [{ id: "proj-1", name: "bb-plugins" }]);
    const { runner } = fakeRunner(() => ({ ok: true, stdout: stdoutWithThreads("sess-1"), stderr: "", code: 0 }));
    const service = createThreadsTimelineService(bb, { processRunner: runner });

    const result = await service.query({ unit: 300 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.threads).toEqual([
      expect.objectContaining({ session: "sess-1", bbThreadTitle: "Untitled session notes" }),
    ]);
  });

  it("defaults bbThreadTitle to null when the matched BB thread has neither title nor titleFallback", async () => {
    const { bb, harness } = createFakePluginHost();
    harness.sdk.stub("threads.list", async () => [{ id: "thread-1", projectId: "proj-1", title: null, titleFallback: null }]);
    harness.sdk.stub("threads.events.list", async () => [identityEvent("thread-1", "sess-1")]);
    harness.sdk.stub("projects.list", async () => [{ id: "proj-1", name: "bb-plugins" }]);
    const { runner } = fakeRunner(() => ({ ok: true, stdout: stdoutWithThreads("sess-1"), stderr: "", code: 0 }));
    const service = createThreadsTimelineService(bb, { processRunner: runner });

    const result = await service.query({ unit: 300 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.threads).toEqual([expect.objectContaining({ session: "sess-1", bbThreadTitle: null })]);
  });

  it("leaves a session unmatched to any scanned BB thread as null (renders as the 'Threads' bucket)", async () => {
    const { bb, harness } = createFakePluginHost();
    harness.sdk.stub("threads.list", async () => [{ id: "thread-1", projectId: "proj-1", title: "Some other thread" }]);
    harness.sdk.stub("threads.events.list", async () => [identityEvent("thread-1", "some-other-session")]);
    harness.sdk.stub("projects.list", async () => [{ id: "proj-1", name: "bb-plugins" }]);
    const { runner } = fakeRunner(() => ({ ok: true, stdout: stdoutWithThreads("sess-unmatched"), stderr: "", code: 0 }));
    const service = createThreadsTimelineService(bb, { processRunner: runner });

    const result = await service.query({ unit: 300 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.threads).toEqual([
      expect.objectContaining({
        session: "sess-unmatched",
        bbProjectId: null,
        bbProjectName: null,
        threadId: null,
        bbThreadTitle: null,
      }),
    ]);
  });

  it("does not fail the slice when bb.sdk.threads.list rejects — every thread comes back unmatched", async () => {
    const { bb, harness } = createFakePluginHost();
    harness.sdk.stub("threads.list", async () => {
      throw new Error("демон недоступен");
    });
    harness.sdk.stub("projects.list", async () => [{ id: "proj-1", name: "bb-plugins" }]);
    const { runner } = fakeRunner(() => ({ ok: true, stdout: stdoutWithThreads("sess-1"), stderr: "", code: 0 }));
    const service = createThreadsTimelineService(bb, { processRunner: runner });

    const result = await service.query({ unit: 300 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.threads).toEqual([
      expect.objectContaining({ session: "sess-1", bbProjectId: null, bbProjectName: null, threadId: null, bbThreadTitle: null }),
    ]);
  });

  it("does not fail the slice when bb.sdk.projects.list rejects — every thread comes back unmatched", async () => {
    const { bb, harness } = createFakePluginHost();
    harness.sdk.stub("threads.list", async () => [{ id: "thread-1", projectId: "proj-1", title: "Design review" }]);
    harness.sdk.stub("threads.events.list", async () => [identityEvent("thread-1", "sess-1")]);
    harness.sdk.stub("projects.list", async () => {
      throw new Error("демон недоступен");
    });
    const { runner } = fakeRunner(() => ({ ok: true, stdout: stdoutWithThreads("sess-1"), stderr: "", code: 0 }));
    const service = createThreadsTimelineService(bb, { processRunner: runner });

    const result = await service.query({ unit: 300 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.threads).toEqual([
      expect.objectContaining({ session: "sess-1", bbProjectId: null, bbProjectName: null, threadId: null, bbThreadTitle: null }),
    ]);
  });

  it("skips the bb.sdk scan entirely for an empty slice", async () => {
    const { bb, harness } = createFakePluginHost();
    const threadsListStub = vi.fn(async () => []);
    harness.sdk.stub("threads.list", threadsListStub);
    const { runner } = fakeRunner(() => ({ ok: true, stdout: VALID_STDOUT, stderr: "", code: 0 }));
    const service = createThreadsTimelineService(bb, { processRunner: runner });

    const result = await service.query({ unit: 300 });

    expect(result.ok).toBe(true);
    expect(threadsListStub).not.toHaveBeenCalled();
  });

  it("reuses the resolver's identity cache across two queries instead of re-resolving the same thread", async () => {
    const { bb, harness } = createFakePluginHost();
    harness.sdk.stub("threads.list", async () => [{ id: "thread-1", projectId: "proj-1" }]);
    harness.sdk.stub("threads.events.list", async () => [identityEvent("thread-1", "sess-1")]);
    harness.sdk.stub("projects.list", async () => [{ id: "proj-1", name: "bb-plugins" }]);
    let now = 0;
    const { runner } = fakeRunner(() => ({ ok: true, stdout: stdoutWithThreads("sess-1"), stderr: "", code: 0 }));
    const service = createThreadsTimelineService(bb, { processRunner: runner, cacheTtlMs: 1000, now: () => now });

    await service.query({ unit: 300 });
    now = 2000; // past the TTL, forces a second uncached run + enrichment pass
    await service.query({ unit: 300 });

    expect(harness.sdk.callsTo("threads.events.list")).toHaveLength(1);
  });
});
