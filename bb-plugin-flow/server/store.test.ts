// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { AnswerRecord, DecisionBrief } from "../shared/contract";
import { KV_VALUE_LIMIT_BYTES, createStore } from "./store";

const briefWith = (title: string, id = "dec_1"): DecisionBrief => ({
  id,
  threadId: "thr_1",
  title,
  createdAt: "2026-09-12T12:00:00.000Z",
  kind: "brief",
  questions: [
    {
      id: "priority",
      question: "Приоритет?",
      kind: "choice",
      allowOwn: false,
      options: [
        { id: "speed", action: "Скорость", recommended: false },
        { id: "quality", action: "Качество", recommended: true },
      ],
    },
  ],
});

const record = (messageId: string): AnswerRecord => ({
  answer: { briefId: "dec_1", answers: [{ questionId: "priority", optionIds: ["quality"] }] },
  messageId,
  answeredAt: "2026-09-12T12:05:00.000Z",
});

const fresh = () => {
  const { bb } = createFakePluginHost({ pluginId: "decisions" });
  return { kv: bb.storage.kv, store: createStore(bb.storage.kv) };
};

describe("хранилище брифов", () => {
  it("записанный бриф читается обратно", async () => {
    const { store } = fresh();
    const brief = briefWith("Как вести работу");
    expect(await store.putBrief(brief)).toEqual({ kind: "stored" });
    expect(await store.getBrief("dec_1")).toEqual(brief);
    expect(await store.getBrief("dec_2")).toBeNull();
    expect(await store.getAnswer("dec_1")).toBeNull();
  });

  it("повторный ответ не перезаписывает первый и возвращает записанный", async () => {
    const { store } = fresh();
    await store.putBrief(briefWith("Бриф"));
    const [first, second] = await Promise.all([store.putAnswer("dec_1", record("msg_a")), store.putAnswer("dec_1", record("msg_b"))]);
    expect(first).toEqual({ kind: "stored", record: record("msg_a") });
    expect(second).toEqual({ kind: "already_answered", record: record("msg_a") });
    expect(await store.putAnswer("dec_1", record("msg_c"))).toEqual({ kind: "already_answered", record: record("msg_a") });
    expect(await store.getAnswer("dec_1")).toEqual(record("msg_a"));
  });

  it("снятый ответ читается как отсутствие, и новый ответ записывается", async () => {
    const { store } = fresh();
    await store.putAnswer("dec_1", record("msg_a"));
    await store.dropAnswer("dec_1");
    expect(await store.getAnswer("dec_1")).toBeNull();
    expect(await store.putAnswer("dec_1", record("msg_b"))).toEqual({ kind: "stored", record: record("msg_b") });
  });

  it("битое значение под ключом брифа читается как отсутствие", async () => {
    const { kv, store } = fresh();
    await kv.set("decision:dec_1", { title: 42 });
    expect(await store.getBrief("dec_1")).toBeNull();
  });

  it("битое значение под ключом ответа читается как отсутствие", async () => {
    const { kv, store } = fresh();
    await kv.set("decision-answer:dec_1", "не ответ");
    expect(await store.getAnswer("dec_1")).toBeNull();
  });

  it("бриф сверх 256 КБ не пишется и называет размер", async () => {
    const { store } = fresh();
    const result = await store.putBrief(briefWith("x".repeat(KV_VALUE_LIMIT_BYTES)));
    expect(result.kind).toBe("too_large");
    expect(result.kind === "too_large" && result.bytes).toBeGreaterThan(KV_VALUE_LIMIT_BYTES);
    expect(await store.getBrief("dec_1")).toBeNull();
  });

  it("бриф с кириллицей считается в байтах UTF-8, а не в символах", async () => {
    const { store } = fresh();
    const title = "я".repeat(Math.ceil(KV_VALUE_LIMIT_BYTES * 0.6));
    expect(title.length).toBeLessThan(KV_VALUE_LIMIT_BYTES);
    const result = await store.putBrief(briefWith(title));
    expect(result.kind).toBe("too_large");
  });
});
