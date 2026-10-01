// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createStore } from "./store";

describe("утверждённые пункты треда", () => {
  it("записанный список читается обратно, у треда без записи — пусто", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const store = createStore(bb.storage.kv);
    expect(await store.getThreadCriteria("thr_1")).toEqual([]);
    await store.putThreadCriteria("thr_1", ["Тесты зелёные", "Кнопка"]);
    expect(await store.getThreadCriteria("thr_1")).toEqual(["Тесты зелёные", "Кнопка"]);
    expect(await store.getThreadCriteria("thr_2")).toEqual([]);
  });

  it("пустой список снимает запись", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const store = createStore(bb.storage.kv);
    await store.putThreadCriteria("thr_1", ["Тесты зелёные"]);
    await store.putThreadCriteria("thr_1", []);
    expect(await store.getThreadCriteria("thr_1")).toEqual([]);
  });
});
