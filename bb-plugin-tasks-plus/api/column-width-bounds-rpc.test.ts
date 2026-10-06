import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { COLUMN_WIDTH_BOUNDS_KV_KEY } from "../shared/board-column-width.js";
import type { KvStore } from "../filesync/board-config.js";
import { createFileTasksStore } from "../filesync/store.js";
import { registerTasksApi, type TasksApiStore } from ".";

// The board's column width bounds: stored in the plugin's kv, read back checked.

function fakeKv(): KvStore {
  const map = new Map<string, unknown>();
  return {
    async get(key) {
      return map.get(key) as never;
    },
    async set(key, value) {
      map.set(key, value);
    },
  };
}

let host: ReturnType<typeof createFakePluginHost>;
const call = (method: string, input: unknown) => host.harness.behavior.callRpc(method as never, input as never);

beforeEach(() => {
  const tasks = createFileTasksStore(fakeKv(), [], [], [], [], () => {});
  const store: TasksApiStore = {
    tasks,
    transitions: { record() {}, range: () => [], firstAtMs: () => null },
    transaction: (operation) => tasks.transaction(operation),
    projectTaskCount: async () => 0,
    projectPrefixExists: () => false,
    openTaskCount: async () => 0,
    sidebarSummary: async () => [],
  };
  host = createFakePluginHost({ pluginId: "tasks" });
  registerTasksApi(host.bb, store, { get: async () => null });
});

describe("loadColumnWidthBounds / saveColumnWidthBounds RPC", () => {
  it("reads 200, 480 and 230 px until the owner chooses otherwise", async () => {
    await expect(call("loadColumnWidthBounds", {})).resolves.toEqual({ min: 200, max: 480, initial: 230 });
  });

  it("reads back what was saved", async () => {
    const bounds = { min: 150, max: 900, initial: 320 };
    await expect(call("saveColumnWidthBounds", bounds)).resolves.toEqual({ ok: true });
    await expect(call("loadColumnWidthBounds", {})).resolves.toEqual(bounds);
    await expect(host.bb.storage.kv.get(COLUMN_WIDTH_BOUNDS_KV_KEY)).resolves.toEqual(bounds);
  });

  it("refuses a minimum above the maximum and keeps what was stored before", async () => {
    await call("saveColumnWidthBounds", { min: 150, max: 900, initial: 320 });
    await expect(call("saveColumnWidthBounds", { min: 600, max: 300, initial: 400 })).rejects.toThrow(
      "Minimum must not exceed maximum.",
    );
    await expect(call("loadColumnWidthBounds", {})).resolves.toEqual({ min: 150, max: 900, initial: 320 });
  });

  it("reads a broken stored value as the default", async () => {
    await host.bb.storage.kv.set(COLUMN_WIDTH_BOUNDS_KV_KEY, { min: "wide" });
    await expect(call("loadColumnWidthBounds", {})).resolves.toEqual({ min: 200, max: 480, initial: 230 });
  });
});
