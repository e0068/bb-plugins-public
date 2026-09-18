// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { askDecisionParamsSchema } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

describe("метка отзыва утверждений", () => {
  it("агент её не передаёт: схема параметров не знает поля revocable", () => {
    const parsed = askDecisionParamsSchema.parse({ title: "Бриф", revocable: false, setup: { executor: { recommended: "self" } } });
    expect("revocable" in parsed).toBe(false);
  });

  it("новый бриф записывается с меткой revocable", async () => {
    const host = createFakePluginHost();
    const store = createStore(host.bb.storage.kv);
    registerAskTool(host.bb, store, { newId: () => "abc", now: () => "2026-09-13T00:00:00.000Z" });
    await host.harness.callAgentTool(ASK_TOOL_NAME, { title: "Бриф", setup: { criteria: ["Тесты зелёные"] } }, { threadId: "thr_1" });
    const stored = await store.getBrief("dec_abc");
    expect(stored?.revocable).toBe(true);
  });
});
