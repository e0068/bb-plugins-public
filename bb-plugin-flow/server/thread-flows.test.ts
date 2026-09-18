// @vitest-environment node
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createThreadFlows } from "./thread-flows";

const created = (id: string, projectId: string, parentThreadId: string | null = null) => ({ thread: makeThreadResponse({ id, projectId, parentThreadId }) });

describe("flow тредов", () => {
  it("выбор проекта доходит до нового треда этого проекта", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const threads = await createThreadFlows(bb.storage.kv);
    await threads.choose("proj_a", "quick");
    threads.onThreadCreated(created("thr_1", "proj_a"));
    expect(threads.flowOf("thr_1")).toBe("quick");
    expect(threads.choiceOf("proj_a")).toBe("quick");
  });

  it("тред проекта без выбора остаётся без привязки", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const threads = await createThreadFlows(bb.storage.kv);
    await threads.choose("proj_a", "quick");
    threads.onThreadCreated(created("thr_2", "proj_b"));
    expect(threads.flowOf("thr_2")).toBeUndefined();
  });

  it("дочерний тред берёт flow родителя, а не выбор проекта", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const threads = await createThreadFlows(bb.storage.kv);
    await threads.choose("proj_a", "quick");
    threads.onThreadCreated(created("thr_parent", "proj_a"));
    await threads.choose("proj_a", "big");
    threads.onThreadCreated(created("thr_child", "proj_a", "thr_parent"));
    expect(threads.flowOf("thr_child")).toBe("quick");
  });

  it("привязки и выбор переживают новое создание", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const first = await createThreadFlows(bb.storage.kv);
    await first.choose("proj_a", "quick");
    first.onThreadCreated(created("thr_1", "proj_a"));
    await first.settled();
    const second = await createThreadFlows(bb.storage.kv);
    expect(second.flowOf("thr_1")).toBe("quick");
    expect(second.choiceOf("proj_a")).toBe("quick");
  });
});
