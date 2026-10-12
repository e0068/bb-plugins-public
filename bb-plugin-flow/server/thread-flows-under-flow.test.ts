// @vitest-environment node
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { AUTO_FLOW, NO_FLOW } from "../core/flows";
import { createThreadFlows } from "./thread-flows";

describe("треды под Flow", () => {
  it("в счёт идут назначенные, унаследованные от проекта и «Автоматически»; отказ от flow — нет; удалённый тред уходит", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const threads = await createThreadFlows(bb.storage.kv);
    await threads.assign("thr_flow", "quick");
    await threads.assign("thr_none", NO_FLOW);
    await threads.assign("thr_auto", AUTO_FLOW);
    await threads.choose("proj_a", "big");
    threads.onThreadCreated({ thread: makeThreadResponse({ id: "thr_new", projectId: "proj_a", parentThreadId: null }) });
    expect(threads.withFlow().sort()).toEqual(["thr_auto", "thr_flow", "thr_new"]);
    threads.onThreadDeleted({ thread: makeThreadResponse({ id: "thr_flow" }) });
    expect(threads.withFlow().sort()).toEqual(["thr_auto", "thr_new"]);
  });

  it("отказ от flow, записанный прежним выбором агентом, читается как «Без flow»", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    await bb.storage.kv.set("thread-flow:thr_old", "none-by-agent");
    const threads = await createThreadFlows(bb.storage.kv);
    expect(threads.flowOf("thr_old")).toBe(NO_FLOW);
    expect(threads.withFlow()).toEqual([]);
  });
});
