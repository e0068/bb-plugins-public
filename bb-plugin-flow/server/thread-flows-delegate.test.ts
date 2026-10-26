// @vitest-environment node
// Дочерний тред другого провайдера, которому Flow отдал этап, идёт без flow; следующий ребёнок того же родителя — с flow родителя (BBPL-965).
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { NO_FLOW } from "../core/flows";
import { createThreadFlows } from "./thread-flows";

const created = (id: string, parentThreadId: string | null = null) => ({ thread: makeThreadResponse({ id, projectId: "proj_a", parentThreadId }) });

describe("дочерний тред этапа", () => {
  it("ребёнок, которого ждали, — без flow, следующий ребёнок — снова с flow родителя", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const threads = await createThreadFlows(bb.storage.kv);
    await threads.choose("proj_a", "big");
    threads.onThreadCreated(created("thr_parent"));
    threads.expectDelegate("thr_parent");
    threads.onThreadCreated(created("thr_codex", "thr_parent"));
    threads.onThreadCreated(created("thr_later", "thr_parent"));
    expect(threads.flowOf("thr_codex")).toBe(NO_FLOW);
    expect(threads.flowOf("thr_later")).toBe("big");
  });

  it("ожидание одного родителя не трогает детей другого", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const threads = await createThreadFlows(bb.storage.kv);
    await threads.choose("proj_a", "big");
    threads.onThreadCreated(created("thr_a"));
    threads.onThreadCreated(created("thr_b"));
    threads.expectDelegate("thr_a");
    threads.onThreadCreated(created("thr_b_child", "thr_b"));
    expect(threads.flowOf("thr_b_child")).toBe("big");
  });
});
