// @vitest-environment node
// Удалённый тред, отдавший работу, уносит свой указатель, а прогон носителя остаётся.
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import plugin from "./server";

describe("архивированный тред", () => {
  it("ключей не теряет: его ещё откроют", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    await bb.storage.kv.set("flow-progress:run_1", { stages: {}, waiting: [], thread: "thr_old" });
    await bb.storage.kv.set("flow-thread:thr_old", { run: "run_1" });
    await plugin(bb);
    await harness.emitThreadEvent("thread.archived", { thread: makeThreadResponse({ id: "thr_old", projectId: "proj_a", parentThreadId: null }) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await bb.storage.kv.get("flow-thread:thr_old")).toEqual({ run: "run_1" });
    expect(await bb.storage.kv.get("flow-progress:run_1")).toBeDefined();
  });
});

describe("удалённый тред, отдавший работу", () => {
  it("снимает свой указатель, прогон носителя остаётся", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    // Прогон начат до указателей под id треда и передан после них: запись под thr_gone ведёт уже thr_new.
    await bb.storage.kv.set("flow-progress:thr_gone", { stages: {}, waiting: [], thread: "thr_new" });
    await bb.storage.kv.set("flow-thread:thr_gone", { run: "thr_gone" });
    await bb.storage.kv.set("flow-thread:thr_new", { run: "thr_gone" });
    await plugin(bb);
    await harness.emitThreadEvent("thread.deleted", { thread: makeThreadResponse({ id: "thr_gone", projectId: "proj_a", parentThreadId: null }) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await bb.storage.kv.get("flow-thread:thr_gone")).toBeUndefined();
    expect(await bb.storage.kv.get("flow-progress:thr_gone")).toBeDefined();
  });
});
