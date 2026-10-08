import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createThreadSessionResolver } from "../thread-session";

/** One thread's identity log as bb keeps it: events in seq order, filtered by afterSeq like the real threads.events.list. */
function identityLog(sessions: string[]) {
  const rows = () =>
    sessions.map((providerThreadId, i) => ({
      id: `evt-${i + 1}`,
      scope: { kind: "thread" as const },
      threadId: "thread-1",
      seq: i + 1,
      createdAt: Date.now(),
      type: "thread/identity" as const,
      data: { providerThreadId },
    }));
  return async ({ afterSeq }: { afterSeq?: string }) => rows().filter((row) => afterSeq === undefined || row.seq > Number(afterSeq));
}

describe("createThreadSessionResolver", () => {
  it("a thread that moved to a new Claude Code session resolves to the latest one, not the first", async () => {
    const { bb, harness } = createFakePluginHost();
    harness.sdk.stub("threads.events.list", identityLog(["sess-first", "sess-current"]));

    expect(await createThreadSessionResolver(bb).resolve("thread-1")).toBe("sess-current");
  });

  it("a session change after the first lookup is picked up, reading only the events after the last one seen", async () => {
    const { bb, harness } = createFakePluginHost();
    const sessions = ["sess-first"];
    harness.sdk.stub("threads.events.list", identityLog(sessions));
    const resolver = createThreadSessionResolver(bb);

    expect(await resolver.resolve("thread-1")).toBe("sess-first");
    sessions.push("sess-current");
    expect(await resolver.resolve("thread-1")).toBe("sess-current");
    expect(harness.sdk.callsTo("threads.events.list").at(-1)?.[0]).toMatchObject({ afterSeq: "1" });
  });

  it("sessionsOf lists every session of the thread once, oldest first", async () => {
    const { bb, harness } = createFakePluginHost();
    harness.sdk.stub("threads.events.list", identityLog(["sess-a", "sess-b", "sess-a"]));

    expect(await createThreadSessionResolver(bb).sessionsOf("thread-1")).toEqual(["sess-a", "sess-b"]);
  });

  it("the thread returning to an earlier session makes that session current again", async () => {
    const { bb, harness } = createFakePluginHost();
    harness.sdk.stub("threads.events.list", identityLog(["sess-a", "sess-b", "sess-a"]));

    expect(await createThreadSessionResolver(bb).resolve("thread-1")).toBe("sess-a");
  });

  it("sessionsOf skips the lookup while the thread hasn't changed since the last check", async () => {
    const { bb, harness } = createFakePluginHost();
    harness.sdk.stub("threads.events.list", identityLog(["sess-a"]));
    let clock = 1_000;
    const resolver = createThreadSessionResolver(bb, { now: () => clock });

    await resolver.sessionsOf("thread-1", 500);
    clock = 2_000;
    await resolver.sessionsOf("thread-1", 500);
    expect(harness.sdk.callsTo("threads.events.list")).toHaveLength(1);

    await resolver.sessionsOf("thread-1", 1_500);
    expect(harness.sdk.callsTo("threads.events.list")).toHaveLength(2);
  });


  it("resolves the providerThreadId from a thread/identity event", async () => {
    const { bb, harness } = createFakePluginHost();
    harness.sdk.stub("threads.events.list", async ({ threadId }: { threadId: string }) => [
      {
        id: "evt-1",
        scope: { kind: "thread" },
        threadId,
        seq: 1,
        createdAt: Date.now(),
        type: "thread/identity",
        data: { providerThreadId: "71e96791-4523-42b7-8994-caa3330e5f9f" },
      },
    ]);

    const resolver = createThreadSessionResolver(bb);
    const sessionId = await resolver.resolve("thread-1");

    expect(sessionId).toBe("71e96791-4523-42b7-8994-caa3330e5f9f");
  });

  it("returns null when the thread has no identity event yet", async () => {
    const { bb, harness } = createFakePluginHost();
    harness.sdk.stub("threads.events.list", async () => []);

    const resolver = createThreadSessionResolver(bb);
    const sessionId = await resolver.resolve("brand-new-thread");

    expect(sessionId).toBeNull();
  });

  it("resolve() re-reads a thread with no session yet, so its first turn is picked up on the next call", async () => {
    // Regression for the bug where a thread opened before its first turn
    // cached `null` forever: once the user sends a message and the
    // transcript appears, the header must stop saying "no session yet".
    const { bb, harness } = createFakePluginHost();
    let providerThreadId: string | null = null;
    harness.sdk.stub("threads.events.list", async ({ threadId }: { threadId: string }) =>
      providerThreadId
        ? [
            {
              id: "evt-1",
              scope: { kind: "thread" },
              threadId,
              seq: 1,
              createdAt: Date.now(),
              type: "thread/identity",
              data: { providerThreadId },
            },
          ]
        : [],
    );

    const resolver = createThreadSessionResolver(bb);
    expect(await resolver.resolve("thread-1")).toBeNull();

    providerThreadId = "sess-abc";
    expect(await resolver.resolve("thread-1")).toBe("sess-abc");
    expect(harness.sdk.callsTo("threads.events.list")).toHaveLength(2);
  });

  it("bounds the cache so it doesn't grow forever across every thread ever viewed", async () => {
    const { bb, harness } = createFakePluginHost();
    harness.sdk.stub("threads.events.list", async ({ threadId }: { threadId: string }) => [
      {
        id: "evt-1",
        scope: { kind: "thread" },
        threadId,
        seq: 1,
        createdAt: Date.now(),
        type: "thread/identity",
        data: { providerThreadId: `sess-${threadId}` },
      },
    ]);

    const resolver = createThreadSessionResolver(bb, { maxCacheEntries: 2 });
    await resolver.sessionsOf("t1", 0);
    await resolver.sessionsOf("t2", 0);
    await resolver.sessionsOf("t3", 0); // pushes the cache past its limit, evicting t1

    await resolver.sessionsOf("t1", 0); // must hit the SDK again, not serve a stale/evicted slot

    expect(harness.sdk.callsTo("threads.events.list")).toHaveLength(4);
  });

  it("clearCache() forces a fresh SDK lookup", async () => {
    const { bb, harness } = createFakePluginHost();
    harness.sdk.stub("threads.events.list", async ({ threadId }: { threadId: string }) => [
      {
        id: "evt-1",
        scope: { kind: "thread" },
        threadId,
        seq: 1,
        createdAt: Date.now(),
        type: "thread/identity",
        data: { providerThreadId: "sess-abc" },
      },
    ]);

    const resolver = createThreadSessionResolver(bb);
    await resolver.sessionsOf("thread-1", 0);
    resolver.clearCache();
    await resolver.sessionsOf("thread-1", 0);

    expect(harness.sdk.callsTo("threads.events.list")).toHaveLength(2);
  });
});
