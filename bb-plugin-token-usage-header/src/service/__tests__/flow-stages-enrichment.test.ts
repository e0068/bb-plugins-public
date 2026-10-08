// threads-timeline-service's Flow stage enrichment: a session matched to a BB
// thread gets that thread's stages from Flow's getStageTimeline RPC; Flow
// failing or missing leaves the session without stages and never fails the slice.
import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { EXPECTED_THREADS_TIMELINE_SCHEMA_VERSION } from "../../core";
import type { ProcessRunner } from "../process-runner";
import { createThreadsTimelineService } from "../threads-timeline-service";

const GLYPH = [["path", { d: "M0 0" }]];
const STAGES = [{ id: "spec", name: "Spec", glyph: GLYPH, passes: [{ from: "2026-10-08T10:00:00.000Z", to: null }] }];

const stdout = (...sessions: string[]) =>
  JSON.stringify({
    schemaVersion: EXPECTED_THREADS_TIMELINE_SCHEMA_VERSION,
    unit: 300,
    threads: sessions.map((session) => ({
      session,
      project: `-Users-e0068-${session}`,
      title: session,
      start: "2026-10-08T10:00:00.000Z",
      end: "2026-10-08T11:00:00.000Z",
      durationSec: 3600,
      totalTokens: 100,
      totalCost: 1,
      workflowCount: 0,
      bins: [],
      cwd: null,
      gitBranch: null,
      events: [],
    })),
    agentLabels: {},
    truncated: false,
  });

const runner: ProcessRunner = async () => ({ ok: true, stdout: stdout("sess-flow", "sess-loose"), stderr: "", code: 0 });

/** A host where sess-flow belongs to BB thread thread-1; sess-loose matches nothing. */
function hostWithFlow(callRpc: (args: { pluginId: string; method: string; input?: unknown }) => Promise<unknown>) {
  const { bb, harness } = createFakePluginHost();
  harness.sdk.stub("threads.list", async () => [{ id: "thread-1", projectId: "proj-1", title: "Markers" }]);
  harness.sdk.stub("threads.events.list", async ({ threadId }: { threadId: string }) =>
    threadId === "thread-1"
      ? [{ id: "evt-1", scope: { kind: "thread" as const }, threadId, seq: 1, createdAt: Date.now(), type: "thread/identity" as const, data: { providerThreadId: "sess-flow" } }]
      : [],
  );
  harness.sdk.stub("projects.list", async () => [{ id: "proj-1", name: "bb-plugins" }]);
  const rpc = vi.fn(callRpc);
  harness.sdk.stub("plugins.callRpc", rpc);
  return { bb, rpc };
}

async function threadsOf(bb: Parameters<typeof createThreadsTimelineService>[0]) {
  const result = await createThreadsTimelineService(bb, { processRunner: runner }).query({ unit: 300 });
  if (!result.ok) throw new Error(result.message);
  return result.data.threads;
}

describe("createThreadsTimelineService: Flow stage enrichment", () => {
  it("asks Flow for the matched thread's stages and attaches them to its session", async () => {
    const { bb, rpc } = hostWithFlow(async () => STAGES);
    const threads = await threadsOf(bb);

    expect(threads.find((t) => t.session === "sess-flow")?.flowStages).toEqual(STAGES);
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({ pluginId: "flow", method: "getStageTimeline", input: { threadId: "thread-1" } }));
  });

  it("a session with no BB thread gets no stages and costs no call", async () => {
    const { bb, rpc } = hostWithFlow(async () => STAGES);
    const threads = await threadsOf(bb);

    expect(threads.find((t) => t.session === "sess-loose")?.flowStages).toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("Flow missing or failing leaves the session without stages, not the slice failed", async () => {
    const { bb } = hostWithFlow(async () => {
      throw new Error('plugin "flow" is not loaded');
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const threads = await threadsOf(bb);

    expect(threads.map((t) => t.flowStages)).toEqual([[], []]);
    expect(log.mock.calls.filter(([line]) => String(line).includes("Flow stages unavailable"))).toHaveLength(1);
    log.mockRestore();
  });
});
