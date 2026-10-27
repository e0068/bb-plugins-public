// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import { registerApi } from "./api";
import { createStore } from "./store";

// Тред «Разбор тредов за сутки» 17.10: шаг git.commit этапа Commit упал и ждал Retry или Skip, потом Commit убрали из flow
// Research. Полоса над композером его не рисует, а значок упавшей автоматизации в левой панели висел без кнопок.
const host = async (stageIds: Record<string, readonly string[]>) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  registerApi(bb, store, { now: () => "2026-10-17T17:00:00.000Z", stages: (threadId) => (stageIds[threadId] ?? []).map((id) => stage(id)) });
  return { harness, store };
};

describe("ждущие треды после правки flow", () => {
  it("упавший шаг этапа, убранного из flow, не держит значок и снимается; этапа из flow — держит", async () => {
    const { harness, store } = await host({ thr_old: ["research", "analyze", "propose", "dispatch", "archive"], thr_live: ["dispatch", "commit"] });
    await store.putAwaiting("thr_old", { briefId: "automation:commit", kind: "automation" });
    await store.putAwaiting("thr_live", { briefId: "automation:commit", kind: "automation" });
    expect(await harness.callRpc("awaitingThreads", {})).toEqual([{ threadId: "thr_live", kind: "automation" }]);
    expect((await store.listAwaiting()).map((entry) => entry.threadId)).toEqual(["thr_live"]);
  });

  it("бриф ждёт ответа и в треде, чей flow сменился", async () => {
    const { harness, store } = await host({});
    await store.putAwaiting("thr_a", { briefId: "dec_1", kind: "approve" });
    expect(await harness.callRpc("awaitingThreads", {})).toEqual([{ threadId: "thr_a", kind: "approve" }]);
  });
});
