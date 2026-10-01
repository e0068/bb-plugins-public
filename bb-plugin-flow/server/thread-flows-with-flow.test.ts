// @vitest-environment node
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { AGENT_NO_FLOW, AUTO_FLOW, NO_FLOW } from "../core/flows";
import { createThreadFlows } from "./thread-flows";

describe("треды с назначенным flow", () => {
  it("в счёт идут назначенные и унаследованные от проекта; отказ от flow и «Автоматически» — нет; удалённый тред уходит", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const threads = await createThreadFlows(bb.storage.kv);
    await threads.assign("thr_flow", "quick");
    await threads.assign("thr_none", NO_FLOW);
    await threads.assign("thr_agent_none", AGENT_NO_FLOW);
    await threads.assign("thr_auto", AUTO_FLOW);
    await threads.choose("proj_a", "big");
    threads.onThreadCreated({ thread: makeThreadResponse({ id: "thr_new", projectId: "proj_a", parentThreadId: null }) });
    expect(threads.withFlow().sort()).toEqual(["thr_flow", "thr_new"]);
    threads.onThreadDeleted({ thread: makeThreadResponse({ id: "thr_flow" }) });
    expect(threads.withFlow()).toEqual(["thr_new"]);
  });
});
