// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createThreadFlows } from "./thread-flows";

const THREAD = "thr_pick";

describe("flow, выбранный над композером до отправки", () => {
  it("выбор не назначает flow треду", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const threads = await createThreadFlows(bb.storage.kv);
    await threads.assign(THREAD, "none");
    await threads.pick(THREAD, "flow-a");
    expect(threads.pickedOf(THREAD)).toBe("flow-a");
    expect(threads.flowOf(THREAD)).toBe("none");
  });

  it("выбор переживает перезапуск плагина", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    await (await createThreadFlows(bb.storage.kv)).pick(THREAD, "flow-a");
    expect((await createThreadFlows(bb.storage.kv)).pickedOf(THREAD)).toBe("flow-a");
  });

  it("взятый выбор снимается: второй раз его нет", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const threads = await createThreadFlows(bb.storage.kv);
    await threads.pick(THREAD, "flow-a");
    expect(await threads.takePicked(THREAD)).toBe("flow-a");
    expect(await threads.takePicked(THREAD)).toBeUndefined();
    expect((await createThreadFlows(bb.storage.kv)).pickedOf(THREAD)).toBeUndefined();
  });

  it("выбор null снимает запомненный", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const threads = await createThreadFlows(bb.storage.kv);
    await threads.pick(THREAD, "flow-a");
    await threads.pick(THREAD, null);
    expect(threads.pickedOf(THREAD)).toBeUndefined();
    expect((await createThreadFlows(bb.storage.kv)).pickedOf(THREAD)).toBeUndefined();
  });

  it("удалённый тред теряет и выбор", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const threads = await createThreadFlows(bb.storage.kv);
    await threads.pick(THREAD, "flow-a");
    threads.onThreadDeleted({ thread: { id: THREAD } });
    await threads.settled();
    expect(threads.pickedOf(THREAD)).toBeUndefined();
    expect((await createThreadFlows(bb.storage.kv)).pickedOf(THREAD)).toBeUndefined();
  });
});
