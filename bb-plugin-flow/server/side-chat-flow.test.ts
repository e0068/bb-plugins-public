// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { NO_FLOW } from "../core/flows";
import { registerFlowChoice } from "./flow-choice";
import { createFlowSettings } from "./flow-settings";
import { createProgress } from "./progress";
import { createStore } from "./store";
import { createThreadFlows } from "./thread-flows";

const PROJECT = "prj_1";

describe("Side chat без Flow", () => {
  it("тред Side chat привязывается к «без flow», хотя у проекта выбран flow; обычный тред проекта берёт выбор проекта", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const threads = await createThreadFlows(bb.storage.kv);
    await threads.choose(PROJECT, "auto");
    threads.onThreadCreated({ thread: { id: "thr_side", projectId: PROJECT, parentThreadId: null, originPluginId: "side-chat" } });
    threads.onThreadCreated({ thread: { id: "thr_main", projectId: PROJECT, parentThreadId: null, originPluginId: null } });
    expect([threads.flowOf("thr_side"), threads.flowOf("thr_main")]).toEqual([NO_FLOW, "auto"]);
  });

  it("композер Side chat не получает выбора flow; обычный тред получает", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    const flows = await createFlowSettings(bb.storage.kv);
    const threads = await createThreadFlows(bb.storage.kv);
    registerFlowChoice(bb, { flows, threads, progress: createProgress(bb.storage.kv), store: createStore(bb.storage.kv), cancelRun: () => undefined, sideChat: async (threadId) => threadId === "thr_side" });
    expect(await harness.callRpc("threadFlowChoice", { threadId: "thr_side" })).toBeNull();
    expect(await harness.callRpc("threadFlowChoice", { threadId: "thr_main" })).not.toBeNull();
  });
});
