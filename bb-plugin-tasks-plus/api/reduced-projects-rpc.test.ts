import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { REDUCED_PROJECTS_KV_KEY } from "../shared/reduced-projects.js";
import type { KvStore } from "../filesync/board-config.js";
import { createFileTasksStore } from "../filesync/store.js";
import { registerTasksApi, type TasksApiStore } from ".";

// Whether Reduced Colors repaints the analytics' projects: stored in the plugin's kv, read back parsed.

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


describe("loadReducedProjects / saveReducedProjects RPC", () => {
  it("repaints the projects until the owner chooses otherwise", async () => {
    await expect(call("loadReducedProjects", {})).resolves.toBe("ramp");
  });

  it("reads back what was saved", async () => {
    await expect(call("saveReducedProjects", { value: "own" })).resolves.toEqual({ ok: true });
    await expect(call("loadReducedProjects", {})).resolves.toBe("own");
    await expect(host.bb.storage.kv.get(REDUCED_PROJECTS_KV_KEY)).resolves.toBe("own");
  });

  it("reads a broken stored value as the default", async () => {
    await host.bb.storage.kv.set(REDUCED_PROJECTS_KV_KEY, { own: true });
    await expect(call("loadReducedProjects", {})).resolves.toBe("ramp");
  });
});
