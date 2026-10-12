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
  setup: { criteria: ["Тесты зелёные"] },
  questions: [
    { id: "priority", question: "Приоритет?", kind: "choice", allowOwn: false, options: [
      { id: "speed", action: "Скорость", recommended: false },
      { id: "quality", action: "Качество", recommended: true },
    ] },
  ],
};

const answer: DecisionAnswer = { briefId: "dec_b", answers: [{ questionId: "priority", optionIds: ["speed"] }] };

describe("ответ на бриф в этом треде", () => {
  it("встаёт в ленту сообщением владельца, а служебное — прогон, бюджет, Definition of Done — видит только агент", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "decisions", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
    const store = createStore(bb.storage.kv);
    await store.putBrief(brief);
    registerApi(bb, store, { now: () => "2026-10-03T12:05:00.000Z" });
    await harness.callRpc("answerBrief", { id: "dec_b", answer, messageId: "msg_1" });
    const sent = harness.sdk.callsTo("threads.send")[0]![0] as { input: Array<{ text?: string; visibility?: string }> };
    expect(sent.input.map((part) => part.visibility)).toEqual([undefined, "agent-only"]);
    expect(sent.input[0]!.text).toBe("Ответы на вопросы «Как вести работу»:\n1. Приоритет? — Скорость (рекомендовал: Качество)");
    expect(sent.input[1]!.text).toContain("Definition of Done");
  });
});

describe("ответ без служебного", () => {
  it("уходит одним видимым сообщением владельца", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "decisions", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
    const store = createStore(bb.storage.kv);
    await store.putBrief({ ...brief, setup: undefined });
    registerApi(bb, store, { now: () => "2026-10-03T12:05:00.000Z" });
    await harness.callRpc("answerBrief", { id: "dec_b", answer, messageId: "msg_1" });
    const sent = harness.sdk.callsTo("threads.send")[0]![0] as { input: Array<{ visibility?: string }> };
    expect(sent.input.map((part) => part.visibility)).toEqual([undefined]);
  });
});

describe("ответ, вставший в ленту", () => {
  it("запись помечена: отвеченный бриф не повторяет слов владельца", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "decisions", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
    const store = createStore(bb.storage.kv);
    await store.putBrief(brief);
    registerApi(bb, store, { now: () => "2026-10-03T12:05:00.000Z" });
    const result = (await harness.callRpc("answerBrief", { id: "dec_b", answer, messageId: "msg_1" })) as { record: { posted?: true } };
    expect(result.record.posted).toBe(true);
    expect((await store.getAnswer("dec_b"))?.posted).toBe(true);
  });
});
