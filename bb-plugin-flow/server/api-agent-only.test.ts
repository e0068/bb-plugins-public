// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const brief: DecisionBrief = {
  id: "dec_b",
  threadId: "thr_1",
  title: "Как вести работу",
  createdAt: "2026-10-03T12:00:00.000Z",
  kind: "brief",
  questions: [
    { id: "priority", question: "Приоритет?", kind: "choice", allowOwn: false, options: [
      { id: "speed", action: "Скорость", recommended: false },
      { id: "quality", action: "Качество", recommended: true },
    ] },
  ],
};

const answer: DecisionAnswer = { briefId: "dec_b", answers: [{ questionId: "priority", optionIds: ["speed"] }] };

describe("ответ на бриф в этом треде", () => {
  it("доходит до агента, а в ленте треда не показывается — там уже стоит отвеченный бриф", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "decisions", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
    const store = createStore(bb.storage.kv);
    await store.putBrief(brief);
    registerApi(bb, store, { now: () => "2026-10-03T12:05:00.000Z" });
    await harness.callRpc("answerBrief", { id: "dec_b", answer, messageId: "msg_1" });
    const sent = harness.sdk.callsTo("threads.send")[0]![0] as { input: Array<{ visibility?: string }> };
    expect(sent.input.map((part) => part.visibility)).toEqual(["agent-only"]);
  });
});
