// @vitest-environment node
// Комментарий к Утверждению его не принимает: этап остаётся открытым, поэтому и внешним автоматизациям ответа нет.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const approval: DecisionBrief = {
  id: "dec_approve",
  threadId: "thr_1",
  title: "Утверждение",
  createdAt: "2026-09-23T12:00:00.000Z",
  kind: "brief",
  questions: [],
  stages: { list: [builtinStage("approve", [])], minButtonWidth: 160 },
  outcome: { stage: "approve", final: true, done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] },
};

async function answered(outcome: DecisionAnswer["outcome"]) {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  await store.putBrief(approval);
  const emitted: unknown[][] = [];
  registerApi(bb, store, { now: () => "2026-09-23T12:05:00.000Z", emit: (...args) => void emitted.push(args) });
  await harness.callRpc("answerBrief", { id: approval.id, answer: { briefId: approval.id, answers: [], outcome }, messageId: "m" });
  return emitted;
}

describe("ответ на Утверждение и событие для Automations", () => {
  it("«Продолжить» сообщает flow.brief-answered", async () => {
    expect(await answered({ accepted: true })).toEqual([["flow.brief-answered", "thr_1"]]);
  });

  it("комментарий не сообщает ничего", async () => {
    expect(await answered({ accepted: false, note: "поправь заголовок" })).toEqual([]);
  });
});
