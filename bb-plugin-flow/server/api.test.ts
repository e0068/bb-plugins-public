// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { answerMessageText } from "../core/answer-message";
import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { ANSWERED_CHANNEL, registerApi } from "./api";
import { createStore } from "./store";

const briefOf = (kind: DecisionBrief["kind"] = "brief"): DecisionBrief =>
  kind === "clarify"
    ? {
        id: "dec_c",
        threadId: "thr_1",
        title: "Влить сразу?",
        createdAt: "2026-09-12T12:00:00.000Z",
        kind,
        questions: [
          { id: "merge", question: "Влить сразу?", kind: "yesno", allowOwn: false, options: [
            { id: "yes", action: "Да", recommended: true },
            { id: "no", action: "Нет", recommended: false },
          ] },
        ],
      }
    : {
        id: "dec_b",
        threadId: "thr_1",
        title: "Как вести работу",
        createdAt: "2026-09-12T12:00:00.000Z",
        kind,
        questions: [
          { id: "priority", question: "Приоритет?", kind: "choice", allowOwn: false, options: [
            { id: "speed", action: "Скорость", recommended: false },
            { id: "quality", action: "Качество", recommended: true },
          ] },
          { id: "artifacts", question: "Что завести?", kind: "toggles", allowOwn: false, options: [
            { id: "task", action: "Задача", recommended: true },
            { id: "spec", action: "Спека", recommended: false },
          ] },
        ],
      };

const fullAnswer: DecisionAnswer = {
  briefId: "dec_b",
  answers: [
    { questionId: "priority", optionIds: ["speed"] },
    { questionId: "artifacts", optionIds: ["task"] },
  ],
};

const setup = async (options: { failSend?: boolean } = {}) => {
  let sendFailures = options.failSend ? 1 : 0;
  const { bb, harness } = createFakePluginHost({
    pluginId: "decisions",
    sdk: {
      threads: {
        send: async () => {
          if (sendFailures > 0) {
            sendFailures -= 1;
            throw new Error("server unavailable");
          }
          return { delivery: "started" };
        },
      },
    },
  });
  const store = createStore(bb.storage.kv);
  await store.putBrief(briefOf("brief"));
  await store.putBrief(briefOf("clarify"));
  registerApi(bb, store, { now: () => "2026-09-12T12:05:00.000Z" });
  const sends = () => harness.sdk.callsTo("threads.send").map((args) => args[0] as { threadId: string; mode: string; input: Array<{ type: string; text: string }> });
  return { harness, store, sends };
};

describe("RPC брифа", () => {
  it("getBrief отдаёт бриф и null вместо ответа до ответа", async () => {
    const { harness } = await setup();
    expect(await harness.callRpc("getBrief", { id: "dec_b" })).toEqual({ kind: "found", brief: briefOf("brief"), answer: null });
  });

  it("getBrief отдаёт записанный ответ после ответа", async () => {
    const { harness } = await setup();
    await harness.callRpc("answerBrief", { id: "dec_b", answer: fullAnswer, messageId: "msg_1" });
    expect(await harness.callRpc("getBrief", { id: "dec_b" })).toEqual({
      kind: "found",
      brief: briefOf("brief"),
      answer: { answer: fullAnswer, messageId: "msg_1", answeredAt: "2026-09-12T12:05:00.000Z" },
    });
  });

  it("getBrief на неизвестный идентификатор отдаёт not_found", async () => {
    const { harness } = await setup();
    expect(await harness.callRpc("getBrief", { id: "dec_zzz" })).toEqual({ kind: "not_found" });
  });

  it("полный ответ записывается и шлёт в тред ровно одно сообщение", async () => {
    const { harness, store, sends } = await setup();
    const result = await harness.callRpc("answerBrief", { id: "dec_b", answer: fullAnswer, messageId: "msg_1" });
    expect(result).toMatchObject({ kind: "accepted" });
    expect((await store.getAnswer("dec_b"))?.answer).toEqual(fullAnswer);
    expect(sends()).toHaveLength(1);
    expect(sends()[0]?.threadId).toBe("thr_1");
  });

  it("текст единственной части сообщения совпадает с answerMessageText", async () => {
    const { harness, sends } = await setup();
    await harness.callRpc("answerBrief", { id: "dec_b", answer: fullAnswer, messageId: "msg_1" });
    const input = sends()[0]?.input ?? [];
    expect(input).toHaveLength(1);
    expect(input[0]).toMatchObject({ type: "text", text: answerMessageText(briefOf("brief"), fullAnswer) });
  });

  it("повторный ответ возвращает already_answered с первым ответом и не шлёт ничего", async () => {
    const { harness, sends } = await setup();
    await harness.callRpc("answerBrief", { id: "dec_b", answer: fullAnswer, messageId: "msg_1" });
    const other: DecisionAnswer = { briefId: "dec_b", answers: [{ questionId: "priority", optionIds: ["quality"] }, { questionId: "artifacts", optionIds: [] }] };
    const again = await harness.callRpc("answerBrief", { id: "dec_b", answer: other, messageId: "msg_1" });
    expect(again).toMatchObject({ kind: "already_answered", record: { answer: fullAnswer } });
    expect(sends()).toHaveLength(1);
  });

  it("неполный ответ возвращает incomplete со списком вопросов и не пишет ничего", async () => {
    const { harness, store, sends } = await setup();
    const partial: DecisionAnswer = { briefId: "dec_b", answers: [{ questionId: "priority", optionIds: ["speed"] }] };
    expect(await harness.callRpc("answerBrief", { id: "dec_b", answer: partial, messageId: "msg_1" })).toEqual({ kind: "incomplete", questionIds: ["artifacts"] });
    expect(await store.getAnswer("dec_b")).toBeNull();
    expect(sends()).toHaveLength(0);
  });

  it("ответ на неизвестный бриф возвращает not_found и не шлёт ничего", async () => {
    const { harness, sends } = await setup();
    expect(await harness.callRpc("answerBrief", { id: "dec_zzz", answer: fullAnswer, messageId: "msg_1" })).toEqual({ kind: "not_found" });
    expect(sends()).toHaveLength(0);
  });

  it("ответ с чужим briefId возвращает not_found и не пишет ничего", async () => {
    const { harness, store, sends } = await setup();
    const foreign: DecisionAnswer = { ...fullAnswer, briefId: "dec_c" };
    expect(await harness.callRpc("answerBrief", { id: "dec_b", answer: foreign, messageId: "msg_1" })).toEqual({ kind: "not_found" });
    expect(await store.getAnswer("dec_b")).toBeNull();
    expect(sends()).toHaveLength(0);
  });

  it("уточнение уходит режимом steer-if-active", async () => {
    const { harness, sends } = await setup();
    await harness.callRpc("answerBrief", { id: "dec_c", answer: { briefId: "dec_c", answers: [{ questionId: "merge", optionIds: ["no"] }] }, messageId: "msg_2" });
    expect(sends()[0]?.mode).toBe("steer-if-active");
  });

  it("бриф уходит режимом queue-if-active", async () => {
    const { harness, sends } = await setup();
    await harness.callRpc("answerBrief", { id: "dec_b", answer: fullAnswer, messageId: "msg_1" });
    expect(sends()[0]?.mode).toBe("queue-if-active");
  });

  it("после записи ответа публикуется decisions:answered с идентификатором", async () => {
    const { harness } = await setup();
    await harness.callRpc("answerBrief", { id: "dec_b", answer: fullAnswer, messageId: "msg_1" });
    expect(ANSWERED_CHANNEL).toBe("decisions:answered");
    expect(harness.realtimeSignals).toEqual([{ channel: "decisions:answered", payload: { id: "dec_b" } }]);
  });

  it("ответ со ссылкой на вопрос не из брифа возвращает incomplete", async () => {
    const { harness, sends } = await setup();
    const stranger: DecisionAnswer = { ...fullAnswer, answers: [...fullAnswer.answers, { questionId: "ghost", optionIds: [] }] };
    expect(await harness.callRpc("answerBrief", { id: "dec_b", answer: stranger, messageId: "msg_1" })).toEqual({ kind: "incomplete", questionIds: ["ghost"] });
    expect(sends()).toHaveLength(0);
  });

  it("сбой отправки сообщения снимает запись ответа, и повтор отправляет заново", async () => {
    const { harness, store, sends } = await setup({ failSend: true });
    await expect(harness.callRpc("answerBrief", { id: "dec_b", answer: fullAnswer, messageId: "msg_1" })).rejects.toThrow();
    expect(await store.getAnswer("dec_b")).toBeNull();
    expect(harness.realtimeSignals).toEqual([]);
    expect(await harness.callRpc("answerBrief", { id: "dec_b", answer: fullAnswer, messageId: "msg_1" })).toMatchObject({ kind: "accepted" });
    expect(sends()).toHaveLength(2);
  });
});
