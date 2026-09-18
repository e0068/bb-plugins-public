// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createStore } from "./store";

const fresh = () => {
  const { bb } = createFakePluginHost({ pluginId: "decisions" });
  return { kv: bb.storage.kv, store: createStore(bb.storage.kv) };
};

describe("перенос выбора на тред", () => {
  it("перенос треда читается тем, что записано", async () => {
    const { store } = fresh();
    await store.putThreadCarry("thr_1", { "setup.executor": ["subagents"] });
    expect(await store.getThreadCarry("thr_1")).toEqual({ "setup.executor": ["subagents"] });
    expect(await store.getThreadCarry("thr_2")).toEqual({});
  });

  it("новый перенос заменяет прежний целиком", async () => {
    const { store } = fresh();
    await store.putThreadCarry("thr_1", { "setup.executor": ["subagents"], "setup.checker": ["self"] });
    await store.putThreadCarry("thr_1", { "setup.testing": ["none"] });
    expect(await store.getThreadCarry("thr_1")).toEqual({ "setup.testing": ["none"] });
  });

  it("у треда без переноса — пустой перенос", async () => {
    expect(await fresh().store.getThreadCarry("thr_empty")).toEqual({});
  });

  it("битое значение читается пустым переносом", async () => {
    const { kv, store } = fresh();
    await kv.set("decision-thread-carry:thr_1", { "setup.executor": "subagents" });
    expect(await store.getThreadCarry("thr_1")).toEqual({});
  });
});
