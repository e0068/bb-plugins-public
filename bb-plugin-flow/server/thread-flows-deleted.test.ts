// @vitest-environment node
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createThreadFlows } from "./thread-flows";

describe("flow удалённого треда", () => {
  it("удалённый тред теряет привязку и в памяти, и в kv", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const threads = await createThreadFlows(bb.storage.kv);
    await threads.choose("proj_a", "quick");
    threads.onThreadCreated({ thread: makeThreadResponse({ id: "thr_1", projectId: "proj_a", parentThreadId: null }) });
    threads.onThreadDeleted({ thread: makeThreadResponse({ id: "thr_1", projectId: "proj_a" }) });
    await threads.settled();
    expect(threads.flowOf("thr_1")).toBeUndefined();
    expect((await createThreadFlows(bb.storage.kv)).flowOf("thr_1")).toBeUndefined();
  });
});
