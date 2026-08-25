import { describe, expect, it } from "vitest";
import { FolderSyncStatusStore, type FolderSyncKv } from "./status-store.js";

function fakeKv(): FolderSyncKv & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get<T>(key: string) {
      return data.get(key) as T | undefined;
    },
    async set(key: string, value: unknown) {
      data.set(key, value);
    },
    async delete(key: string) {
      data.delete(key);
    },
  };
}

describe("FolderSyncStatusStore", () => {
  it("defaults to not_synced for an unknown project", async () => {
    const store = new FolderSyncStatusStore(fakeKv());
    expect(await store.load("p1")).toEqual({ kind: "not_synced" });
    expect(store.peek("p1")).toEqual({ kind: "not_synced" });
  });

  it("keeps syncing in memory only, never persisting it to kv", async () => {
    const kv = fakeKv();
    const store = new FolderSyncStatusStore(kv);
    store.setSyncing("p1");
    expect(store.peek("p1")).toEqual({ kind: "syncing" });
    expect(kv.data.size).toBe(0);
  });

  it("persists synced and error outcomes, and reloads them", async () => {
    const kv = fakeKv();
    const store = new FolderSyncStatusStore(kv);
    await store.setSynced(
      "p1",
      { created: 2, updated: 0, adopted: 0, deleted: 0, invalid: 0 },
      [],
      "2026-08-20T00:00:00.000Z",
    );
    expect(store.peek("p1")).toEqual({
      kind: "synced",
      syncedAt: "2026-08-20T00:00:00.000Z",
      summary: { created: 2, updated: 0, adopted: 0, deleted: 0, invalid: 0 },
      invalidFiles: [],
    });

    // A fresh store (simulating a reload) reads the persisted value back.
    const reloaded = new FolderSyncStatusStore(kv);
    expect(await reloaded.load("p1")).toEqual(store.peek("p1"));

    await store.setError("p1", "scan failed", "2026-08-20T00:05:00.000Z");
    expect(store.peek("p1")).toEqual({
      kind: "error",
      failedAt: "2026-08-20T00:05:00.000Z",
      message: "scan failed",
    });
    expect(await reloaded.load("p1")).not.toEqual(store.peek("p1")); // stale cache
  });

  it("clear() drops both the cache and the persisted row", async () => {
    const kv = fakeKv();
    const store = new FolderSyncStatusStore(kv);
    await store.setSynced(
      "p1",
      { created: 1, updated: 0, adopted: 0, deleted: 0, invalid: 0 },
      [],
      "2026-08-20T00:00:00.000Z",
    );
    await store.clear("p1");
    expect(store.peek("p1")).toEqual({ kind: "not_synced" });
    expect(await store.load("p1")).toEqual({ kind: "not_synced" });
    expect(kv.data.has("folder-sync:p1")).toBe(false);
  });
});
