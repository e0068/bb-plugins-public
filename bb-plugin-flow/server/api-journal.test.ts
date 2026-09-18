// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { Locale } from "../lib/i18n";
import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const brief: DecisionBrief = {
  id: "dec_j",
  threadId: "thr_j",
  title: "Куда журналить",
  createdAt: "2026-09-15T12:00:00.000Z",
  kind: "brief",
  questions: [{ id: "q", question: "Что?", kind: "yesno", allowOwn: false, options: [{ id: "yes", action: "Да", recommended: true }, { id: "no", action: "Нет", recommended: false }] }],
};

const clarify: DecisionBrief = { ...brief, id: "dec_c", kind: "clarify" };

const answer: DecisionAnswer = { briefId: "dec_j", answers: [{ questionId: "q", optionIds: ["yes"] }] };

type WriteDecision = (args: { brief: DecisionBrief; answer: DecisionAnswer; decidedAt: string; locale?: Locale }) => Promise<unknown>;

const setup = async (writeDecision?: WriteDecision) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  await store.putBrief(brief);
  await store.putBrief({ ...clarify, questions: brief.questions });
  registerApi(bb, store, { now: () => "2026-09-15T12:05:00.000Z", writeDecision });
  return { harness };
};

describe("answerBrief пишет журнал решения", () => {
  it("зовёт writeDecision с брифом, ответом и временем ответа после того, как ответ принят", async () => {
    const calls: unknown[] = [];
    const { harness } = await setup(async (args) => {
      calls.push(args);
      return { kind: "written", path: "memory/decisions/kuda-zhurnalit.md" };
    });
    const result = await harness.callRpc("answerBrief", { id: "dec_j", answer, messageId: "msg_1", locale: "en" });
    expect(result).toMatchObject({ kind: "accepted" });
    expect(calls).toEqual([{ brief, answer, decidedAt: "2026-09-15T12:05:00.000Z", locale: "en" }]);
  });

  it("не зовёт writeDecision для уточнения — это не решение", async () => {
    const calls: unknown[] = [];
    const { harness } = await setup(async (args) => {
      calls.push(args);
      return { kind: "written", path: "x" };
    });
    const clarifyAnswer: DecisionAnswer = { briefId: "dec_c", answers: [{ questionId: "q", optionIds: ["yes"] }] };
    const result = await harness.callRpc("answerBrief", { id: "dec_c", answer: clarifyAnswer, messageId: "msg_2" });
    expect(result).toMatchObject({ kind: "accepted" });
    expect(calls).toHaveLength(0);
  });

  it("сбой writeDecision не мешает принять ответ", async () => {
    const { harness } = await setup(async () => {
      throw new Error("host unreachable");
    });
    const result = await harness.callRpc("answerBrief", { id: "dec_j", answer, messageId: "msg_1" });
    expect(result).toMatchObject({ kind: "accepted" });
  });

  it("без writeDecision в deps — ответ принимается как раньше", async () => {
    const { harness } = await setup(undefined);
    const result = await harness.callRpc("answerBrief", { id: "dec_j", answer, messageId: "msg_1" });
    expect(result).toMatchObject({ kind: "accepted" });
  });
});
