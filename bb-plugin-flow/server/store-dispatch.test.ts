// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createStore } from "./store";

const store = () => {
  const { bb } = createFakePluginHost({ pluginId: "flow" });
  return { store: createStore(bb.storage.kv), kv: bb.storage.kv };
};

describe("отметка запущенной работы", () => {
  it("тред без отметки не запущен", async () => {
    const { store: s } = store();
    expect(await s.isLaunched("thr_1")).toBe(false);
  });

  it("отметка держится по треду, а не на всех сразу", async () => {
    const { store: s } = store();
    await s.markLaunched("thr_1");
    expect(await s.isLaunched("thr_1")).toBe(true);
    expect(await s.isLaunched("thr_2")).toBe(false);
  });

  it("битое значение читается как «не запущен»", async () => {
    const { store: s, kv } = store();
    await kv.set("decision-launched:thr_1", { nonsense: true });
    expect(await s.isLaunched("thr_1")).toBe(false);
  });
});
