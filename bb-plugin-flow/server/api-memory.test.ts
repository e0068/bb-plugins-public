// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { forecast } from "../core/budget";
import { SETUP_ROW } from "../core/rows";
import type { BriefSetup, DecisionAnswer, DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const brief: DecisionBrief = {
  id: "dec_mem",
  threadId: "thr_mem",
  title: "Бриф с прогнозом",
  createdAt: "2026-09-14T12:00:00.000Z",
  kind: "brief",
  planning: { minutes: 12, cost: 1.4 },
  setup: {
    executor: { recommended: "self", adds: { subagents: { target: 3, max: 5, risk: 1, minutes: -20 } } },
    checker: { recommended: "none" },
  } as BriefSetup,
  questions: [],
};

const bare: DecisionBrief = { ...brief, id: "dec_bare", planning: undefined, setup: { executor: { recommended: "self" } } as BriefSetup };

const clarify: DecisionBrief = {
  id: "dec_clar",
  threadId: "thr_mem",
  title: "Влить?",
  createdAt: "2026-09-14T12:00:00.000Z",
  kind: "clarify",
  questions: [{ id: "merge", question: "Влить?", kind: "yesno", allowOwn: false, options: [{ id: "yes", action: "Да", recommended: true }, { id: "no", action: "Нет", recommended: false }] }],
};

const answer: DecisionAnswer = {
  briefId: brief.id,
  answers: [
    { questionId: SETUP_ROW.executor, optionIds: ["subagents"], picked: ["subagents"] },
    { questionId: SETUP_ROW.checker, optionIds: ["none"] },
  ],
};

const setup = async (failSend = false) => {
  const { bb, harness } = createFakePluginHost({
    pluginId: "decisions",
    sdk: {
      threads: {
        send: async () => {
          if (failSend) throw new Error("server unavailable");
          return { delivery: "started" };
        },
      },
    },
  });
  const store = createStore(bb.storage.kv);
  for (const b of [brief, bare, clarify]) await store.putBrief(b);
  registerApi(bb, store, { now: () => "2026-09-14T12:05:00.000Z" });
  return { harness, store };
};

describe("снимок прогноза и перенос при приёме ответа", () => {
  it("ответ брифа без прогноза снимка не несёт", async () => {
    const { harness, store } = await setup();
    await harness.callRpc("answerBrief", { id: bare.id, answer: { briefId: bare.id, answers: [{ questionId: SETUP_ROW.executor, optionIds: ["self"] }] }, messageId: "msg_1" });
    expect((await store.getAnswer(bare.id))?.forecast).toBeUndefined();
  });

  it("принятый ответ пишет перенос треда", async () => {
    const { harness, store } = await setup();
    await harness.callRpc("answerBrief", { id: brief.id, answer, messageId: "msg_1" });
    expect(await store.getThreadCarry("thr_mem")).toEqual({ [SETUP_ROW.executor]: ["subagents"] });
  });

  it("ответ уточнения переноса не пишет", async () => {
    const { harness, store } = await setup();
    await store.putThreadCarry("thr_mem", { [SETUP_ROW.executor]: ["workflow"] });
    await harness.callRpc("answerBrief", { id: clarify.id, answer: { briefId: clarify.id, answers: [{ questionId: "merge", optionIds: ["yes"] }] }, messageId: "msg_1" });
    expect(await store.getThreadCarry("thr_mem")).toEqual({ [SETUP_ROW.executor]: ["workflow"] });
  });

  it("несостоявшаяся реплика переноса не пишет", async () => {
    const { harness, store } = await setup(true);
    await expect(harness.callRpc("answerBrief", { id: brief.id, answer, messageId: "msg_1" })).rejects.toThrow();
    expect(await store.getThreadCarry("thr_mem")).toEqual({});
  });
});

describe("снимок прогноза без уже потраченного", () => {
  it("принятый ответ пишет в запись тот же прогноз, что считает ядро", async () => {
    const { harness, store } = await setup();
    await harness.callRpc("answerBrief", { id: brief.id, answer, messageId: "msg_1" });
    const record = await store.getAnswer(brief.id);
    expect(record?.forecast).toEqual(JSON.parse(JSON.stringify(forecast(brief, answer))));
  });
});
