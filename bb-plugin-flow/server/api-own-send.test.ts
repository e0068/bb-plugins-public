// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const T = "2026-09-18T10:00:00.000Z";

const brief: DecisionBrief = { id: "dec_q", threadId: "thr_1", title: "Вопрос", createdAt: T, kind: "clarify", questions: [{ id: "go", kind: "yesno", question: "Идём?", allowOwn: false, options: [{ id: "yes", action: "Да", recommended: true }, { id: "no", action: "Нет", recommended: false }] }] };

describe("ответ на бриф — своя отправка Flow", () => {
  it("реплика отмечена своей до того, как ушла: хук следующего прогона её не придержит", async () => {
    const order: string[] = [];
    const { bb, harness } = createFakePluginHost({
      pluginId: "flow",
      sdk: {
        threads: {
          send: async () => {
            order.push("send");
            return { delivery: "started" };
          },
        },
      },
    });
    const store = createStore(bb.storage.kv);
    await store.putBrief(brief);
    const marked: Array<[string, string]> = [];
    registerApi(bb, store, { now: () => T, ownSend: (threadId, text) => void (marked.push([threadId, text]), order.push("mark")) });
    const answer: DecisionAnswer = { briefId: brief.id, answers: [{ questionId: "go", optionIds: ["yes"] }] };
    await harness.callRpc("answerBrief", { id: brief.id, answer, messageId: "m" });
    const sent = harness.sdk.callsTo("threads.send")[0]![0] as { input: Array<{ type: string; text?: string }> };
    expect(order).toEqual(["mark", "send"]);
    expect(marked).toEqual([["thr_1", sent.input[0]!.text]]);
  });
});
