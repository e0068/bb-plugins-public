// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { DecisionBrief, FlowProgress } from "../shared/contract";
import { createProgress } from "./progress";

const at = "2026-10-03T11:00:00.000Z";
const running: FlowProgress = { stages: { task: { startedAt: at, finishedAt: at } }, waiting: [], planned: { minutes: 175, target: 35, max: 63 } };

const midWork: DecisionBrief = {
  id: "dec_mid",
  threadId: "thr_a",
  title: "Через какой канал",
  createdAt: at,
  kind: "brief",
  launched: true,
  approvedBudget: { minutes: 175, target: 35, max: 63 },
  questions: [],
};

describe("полоса прогресса после уточнения посреди работы", () => {
  it("ответ на бриф посреди работы с прогнозом записывает прогону новый итог", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const progress = createProgress(bb.storage.kv);
    await progress.update("thr_a", () => running);
    await progress.recordAnswer(midWork, { briefId: midWork.id, answers: [] }, at, { minutes: 235, target: 45, max: 78 });
    expect((await progress.get("thr_a"))?.planned).toEqual({ minutes: 235, target: 45, max: 78 });
  });
});
