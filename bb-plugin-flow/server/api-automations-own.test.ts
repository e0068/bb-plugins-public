// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const brief: DecisionBrief = {
  id: "dec_own",
  threadId: "thr_1",
  title: "Как вести работу",
  createdAt: "2026-10-04T00:00:00.000Z",
  kind: "brief",
  questions: [{ id: "q", question: "Да?", kind: "choice", allowOwn: true, options: [{ id: "yes", action: "Да", recommended: true }, { id: "no", action: "Нет", recommended: false }] }],
};

describe("свой ответ в строке вопроса обычного брифа", () => {
  it("по-прежнему сообщает flow.brief-answered", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
    const store = createStore(bb.storage.kv);
    await store.putBrief(brief);
    const emitted: unknown[][] = [];
    registerApi(bb, store, { now: () => "2026-10-04T00:05:00.000Z", emit: (...args) => void emitted.push(args) });
    const answer: DecisionAnswer = { briefId: "dec_own", answers: [{ questionId: "q", optionIds: [], own: "и ещё вот что" }] };
    expect(await harness.callRpc("answerBrief", { id: "dec_own", answer, messageId: "m" })).toMatchObject({ kind: "accepted" });
    expect(emitted).toEqual([["flow.brief-answered", "thr_1"]]);
  });
});
