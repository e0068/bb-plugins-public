import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_REDUCED_COLORS, REDUCED_COLORS_KV_KEY, type ReducedColors } from "@bb-plugins/reduced-colors";
import type { KvStore } from "../filesync/board-config.js";
import { createFileTasksStore } from "../filesync/store.js";
import { registerTasksApi, type TasksApiStore } from ".";

// The analytics screen's Reduced Colors: stored in the plugin's kv, read back whole.

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

const CUSTOM: ReducedColors = {
  enabled: true,
  light: { low: "#0000ff", high: "#aabbcc" },
  dark: { low: "#112233", high: "#ffffff" },
};

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

describe("loadReducedColors / saveReducedColors RPC", () => {
  it("loads the switched-off defaults before anything is saved", async () => {
    await expect(call("loadReducedColors", {})).resolves.toEqual(DEFAULT_REDUCED_COLORS);
  });

  it("loads back what was saved", async () => {
    await expect(call("saveReducedColors", CUSTOM)).resolves.toEqual({ ok: true });
    await expect(call("loadReducedColors", {})).resolves.toEqual(CUSTOM);
  });

  it("stores the value in the plugin's kv under the shared key", async () => {
    await call("saveReducedColors", CUSTOM);
    await expect(host.bb.storage.kv.get(REDUCED_COLORS_KV_KEY)).resolves.toEqual(CUSTOM);
  });

  it("loads junk in kv as the defaults, keeping whatever part is still valid", async () => {
    await host.bb.storage.kv.set(REDUCED_COLORS_KV_KEY, { enabled: true, light: "blue" });
    await expect(call("loadReducedColors", {})).resolves.toEqual({ ...DEFAULT_REDUCED_COLORS, enabled: true });
  });
});
