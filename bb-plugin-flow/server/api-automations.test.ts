// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const brief = (criteria: boolean): DecisionBrief => ({
  id: "dec_b",
  threadId: "thr_1",
  title: "Как вести работу",
  createdAt: "2026-09-16T12:00:00.000Z",
  kind: "brief",
  questions: [{ id: "q", question: "Да?", kind: "choice", allowOwn: false, options: [{ id: "yes", action: "Да", recommended: true }, { id: "no", action: "Нет", recommended: false }] }],
  ...(criteria ? { setup: { criteria: ["Кнопка видна"] } } : {}),
});
const answer: DecisionAnswer = { briefId: "dec_b", answers: [{ questionId: "q", optionIds: ["yes"] }] };

async function setup(options: { criteria?: boolean; failSend?: boolean; throwingEmit?: boolean } = {}) {
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        send: async () => {
          if (options.failSend) throw new Error("server unavailable");
          return { delivery: "started" };
        },
      },
    },
  });
  const store = createStore(bb.storage.kv);
  await store.putBrief(brief(options.criteria ?? false));
  const emitted: unknown[][] = [];
  registerApi(bb, store, {
    now: () => "2026-09-16T12:05:00.000Z",
    emit: (...args) => {
      emitted.push(args);
      if (options.throwingEmit) throw new Error("automations down");
    },
  });
  return { harness, emitted };
}

describe("события ответа на бриф для Automations", () => {
  it("принятый ответ сообщает flow.brief-answered", async () => {
    const { harness, emitted } = await setup();
    expect(await harness.callRpc("answerBrief", { id: "dec_b", answer, messageId: "m" })).toMatchObject({ kind: "accepted" });
    expect(emitted).toEqual([["flow.brief-answered", "thr_1"]]);
  });

  it("ответ на бриф с критериями сообщает ещё и flow.criteria-approved", async () => {
    const { harness, emitted } = await setup({ criteria: true });
    await harness.callRpc("answerBrief", { id: "dec_b", answer, messageId: "m" });
    expect(emitted).toEqual([["flow.brief-answered", "thr_1"], ["flow.criteria-approved", "thr_1"]]);
  });

  it("неполный, повторный и не дошедший ответ не сообщают ничего", async () => {
    const incomplete = await setup();
    await incomplete.harness.callRpc("answerBrief", { id: "dec_b", answer: { briefId: "dec_b", answers: [] }, messageId: "m" });
    expect(incomplete.emitted).toEqual([]);
    const failed = await setup({ failSend: true });
    await expect(failed.harness.callRpc("answerBrief", { id: "dec_b", answer, messageId: "m" })).rejects.toThrow();
    expect(failed.emitted).toEqual([]);
    const twice = await setup();
    await twice.harness.callRpc("answerBrief", { id: "dec_b", answer, messageId: "m" });
    await twice.harness.callRpc("answerBrief", { id: "dec_b", answer, messageId: "m" });
    expect(twice.emitted).toHaveLength(1);
  });

  it("упавшее событие не ломает ответ", async () => {
    const { harness } = await setup({ throwingEmit: true });
    expect(await harness.callRpc("answerBrief", { id: "dec_b", answer, messageId: "m" })).toMatchObject({ kind: "accepted" });
  });
});
