import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createThreadSessionResolver } from "../thread-session";

describe("createThreadSessionResolver", () => {
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

  it("caches the result and doesn't call the SDK again for the same thread", async () => {
    const { bb, harness } = createFakePluginHost();
    let calls = 0;
    harness.sdk.stub("threads.events.list", async ({ threadId }: { threadId: string }) => {
      calls++;
      return [
        {
          id: "evt-1",
          scope: { kind: "thread" },
          threadId,
          seq: 1,
          createdAt: Date.now(),
          type: "thread/identity",
          data: { providerThreadId: "sess-abc" },
        },
      ];
    });

    const resolver = createThreadSessionResolver(bb);
    await resolver.resolve("thread-1");
    await resolver.resolve("thread-1");

    expect(calls).toBe(1);
    expect(harness.sdk.callsTo("threads.events.list")).toHaveLength(1);
  });

  it("does not cache a null result, so a thread that just got its first turn is picked up on the next call", async () => {
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

  it("bounds the positive-result cache so it doesn't grow forever across every thread ever viewed", async () => {
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
    await resolver.resolve("t1");
    await resolver.resolve("t2");
    await resolver.resolve("t3"); // pushes the cache past its limit, evicting t1

    await resolver.resolve("t1"); // must hit the SDK again, not serve a stale/evicted slot

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
    await resolver.resolve("thread-1");
    resolver.clearCache();
    await resolver.resolve("thread-1");

    expect(harness.sdk.callsTo("threads.events.list")).toHaveLength(2);
  });
});
