// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const brief: DecisionBrief = {
  id: "dec_refused",
  threadId: "thr_1",
  title: "Уточнение",
  createdAt: "2026-10-21T16:43:00.000Z",
  kind: "clarify",
  questions: [{ id: "ok", question: "Так?", kind: "yesno", allowOwn: false, options: [
    { id: "yes", action: "Да", recommended: true },
    { id: "no", action: "Нет", recommended: false },
  ] }],
};

/** Демонстрация — отчёт: ответ на неё сервер отбивает. */
const demo: DecisionBrief = {
  id: "dec_demo",
  threadId: "thr_1",
  title: "Демонстрация",
  createdAt: "2026-10-21T16:43:00.000Z",
  kind: "brief",
  questions: [],
  outcome: { stage: "demo", final: true, done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] },
};

const setup = async () => {
  const warned: string[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: { threads: { send: async () => ({ delivery: "started" }), get: async () => ({ id: "thr_1", projectId: "prj_1", environmentId: "env_1", title: "Тред" }) } as never },
  });
  const store = createStore(bb.storage.kv);
  await store.putBrief(brief);
  await store.putBrief(demo);
  registerApi(bb, store, { now: () => "2026-10-21T16:43:00.000Z", warn: (message) => warned.push(message) });
  return { harness, warned };
};

describe("журнал Flow при сбое ответа на бриф", () => {
  it("отказ ответа записан в журнал с брифом и причиной, а виджет получает ту же ошибку", async () => {
    const { harness, warned } = await setup();
    const answer = { briefId: demo.id, answers: [] };
    await expect(harness.callRpc("answerBrief", { id: demo.id, messageId: "msg_1", answer })).rejects.toThrow(/a demo is a report/);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(demo.id);
    expect(warned[0]).toMatch(/a demo is a report/);
  });

  it("принятый ответ журнал не трогает", async () => {
    const { harness, warned } = await setup();
    const answer = { briefId: brief.id, answers: [{ questionId: "ok", optionIds: ["yes"] }] };
    expect(await harness.callRpc("answerBrief", { id: brief.id, messageId: "msg_1", answer })).toMatchObject({ kind: "accepted" });
    expect(warned).toEqual([]);
  });
});
