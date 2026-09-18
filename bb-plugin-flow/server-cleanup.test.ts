// @vitest-environment node
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import plugin from "./server";

describe("удалённый тред", () => {
  it("снимает ожидание и прогресс треда", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    await plugin(bb);
    await bb.storage.kv.set("flow-awaiting", { thr_gone: { briefId: "dec_1", kind: "select" }, thr_live: { briefId: "dec_2", kind: "demo" } });
    await bb.storage.kv.set("flow-progress:thr_gone", { stages: {}, waiting: [] });
    await harness.emitThreadEvent("thread.deleted", { thread: makeThreadResponse({ id: "thr_gone", projectId: "proj_a", parentThreadId: null }) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await harness.callRpc("awaitingThreads", {})).toEqual([{ threadId: "thr_live", kind: "demo" }]);
    expect(await bb.storage.kv.get("flow-progress:thr_gone")).toBeUndefined();
  });
});
