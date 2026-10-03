// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { DecisionBrief, FlowProgress } from "../shared/contract";
import { registerApi } from "./api";
import { createProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_run";

/** Уточнение посреди работы: прогон утверждён за $35–63 и 175 мин при объёме $7–12.6 и 35 мин. */
const midWork: DecisionBrief = {
  id: "dec_mid",
  threadId: THREAD,
  title: "Через какой канал",
  createdAt: "2026-10-03T10:00:00.000Z",
  kind: "brief",
  launched: true,
  approvedBudget: { minutes: 175, target: 35, max: 63 },
  approvedScope: { target: 7, max: 12.6, risk: 2, minutes: 35 },
  questions: [
    { id: "how", kind: "fork", allowOwn: false, question: "Канал?", options: [
      { id: "feed", action: "Лента", description: "Раз в 2 минуты", recommended: true, add: { target: 2, max: 3, risk: 1, minutes: 12 } },
      { id: "push", action: "Ретранслятор", description: "Мгновенно", recommended: false, add: { target: 4, max: 6, risk: 2, minutes: 20 } },
    ] },
  ],
};

const running: FlowProgress = { stages: {}, waiting: [], planned: { minutes: 175, target: 35, max: 63 } };

const setup = async () => {
  const sent: Array<Record<string, unknown>> = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: { threads: { send: async (args: unknown) => (sent.push(args as Record<string, unknown>), { delivery: "started" }) } },
  });
  const store = createStore(bb.storage.kv);
  const progress = createProgress(bb.storage.kv);
  await store.putBrief(midWork);
  await progress.update(THREAD, () => running);
  registerApi(bb, store, { now: () => "2026-10-03T10:05:00.000Z", progress });
  await harness.callRpc("answerBrief", { id: midWork.id, answer: { briefId: midWork.id, answers: [{ questionId: "how", optionIds: ["feed"] }] }, messageId: "msg_1" });
  return { store, progress, sent };
};

describe("ответ на уточнение посреди работы", () => {
  it("ответ пишет снимок прогноза с новым итогом", async () => {
    const { store } = await setup();
    const f = (await store.getAnswer(midWork.id))?.forecast;
    expect([f?.target, f?.max, f?.minutes]).toEqual([45, 78, 235]);
  });

  it("реплика агенту несёт строку «Бюджет» с новым итогом", async () => {
    const { sent } = await setup();
    expect(JSON.stringify(sent)).toContain("Бюджет — прогноз $45 · до $78");
  });

  it("полоса прогресса получает новый итог прогона", async () => {
    const { progress } = await setup();
    expect((await progress.get(THREAD))?.planned).toEqual({ minutes: 235, target: 45, max: 78 });
  });
});
