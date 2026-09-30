// @vitest-environment node
// Сбор старых ответов из брифов стоит мегабайты чтения: он идёт один раз, сколько бы показов итогов ни пришло разом.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createJournalIndex } from "./journal-index";
import { createStore } from "./store";

describe("сбор индекса журнала", () => {
  it("идёт один раз на все треды, в том числе при одновременных показах", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const store = createStore(bb.storage.kv);
    let scans = 0;
    const counted = { ...store, briefIds: () => ((scans += 1), store.briefIds()) };
    const index = createJournalIndex(bb.storage.kv, counted);
    await Promise.all(["thr_a", "thr_b", "thr_c"].map((threadId) => index.entries(threadId)));
    await index.entries("thr_a");
    expect(scans).toBe(1);
  });

  it("сбор, сорвавшийся на чтении, следующий показ пробует снова", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const store = createStore(bb.storage.kv);
    let scans = 0;
    const flaky = {
      ...store,
      briefIds: async () => {
        scans += 1;
        if (scans === 1) throw new Error("kv unavailable");
        return store.briefIds();
      },
    };
    const index = createJournalIndex(bb.storage.kv, flaky);
    await expect(index.entries("thr_a")).rejects.toThrow("kv unavailable");
    expect(await index.entries("thr_a")).toEqual([]);
    expect(scans).toBe(2);
  });
});
