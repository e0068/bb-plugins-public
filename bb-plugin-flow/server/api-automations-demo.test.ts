// @vitest-environment node
// Комментарий к Демонстрации её не принимает: этап остаётся открытым, поэтому и внешним автоматизациям ответа нет.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const demo: DecisionBrief = {
  id: "dec_demo",
  threadId: "thr_1",
  title: "Демонстрация",
  createdAt: "2026-09-23T12:00:00.000Z",
  kind: "brief",
  questions: [],
  outcome: { stage: "demo", final: true, done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] },
};

async function answered(outcome: DecisionAnswer["outcome"]) {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  await store.putBrief(demo);
  const emitted: unknown[][] = [];
  registerApi(bb, store, { now: () => "2026-09-23T12:05:00.000Z", emit: (...args) => void emitted.push(args) });
  await harness.callRpc("answerBrief", { id: demo.id, answer: { briefId: demo.id, answers: [], outcome }, messageId: "m" });
  return emitted;
}

describe("ответ на Демонстрацию и событие для Automations", () => {
  it("«Продолжить» сообщает flow.brief-answered", async () => {
    expect(await answered({ accepted: true })).toEqual([["flow.brief-answered", "thr_1"]]);
  });

  it("комментарий не сообщает ничего", async () => {
    expect(await answered({ accepted: false, note: "поправь заголовок" })).toEqual([]);
  });
});
