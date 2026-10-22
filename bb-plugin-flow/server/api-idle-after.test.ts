// @vitest-environment node
// Утверждение, за которым в прогоне только автоматизации, предлагало
// «В этом треде · компактировать»: сжатие тратит ход, а агенту после ответа
// делать нечего. Виджет узнаёт это от getBrief — по тому же правилу, по
// которому ответ решает, будить ли агента.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import type { DecisionBrief, FlowProgress, WorkStage } from "../shared/contract";
import { registerApi } from "./api";
import { createProgress } from "./progress";
import { createStore } from "./store";

const work = stage("implement", { name: "Реализация" });
const approve = stage("approve", { kind: "approve", skill: "", name: "Утверждение" });
const merge = stage("merge", { skill: "", name: "Смёрджить PR", automation: { source: "flow", steps: ["git.commit"] } });
const action = stage("ship", { kind: "action", skill: "", name: "Выкатить", automation: { source: "flow", steps: ["git.commit"] } });

const approval = (list: WorkStage[]): DecisionBrief => ({
  id: "dec_approve",
  threadId: "thr_1",
  title: "Утверждение",
  createdAt: "2026-10-22T06:00:00.000Z",
  kind: "brief",
  questions: [],
  stages: { list, minButtonWidth: 160 },
  outcome: { stage: "approve", final: false, done: ["Сделано"], pending: [], results: [{ label: "a.ts", target: "a.ts" }] },
});

const DONE = "2026-10-22T05:00:00.000Z";

const getBrief = async (brief: DecisionBrief, progress: FlowProgress | null) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  await store.putBrief(brief);
  if (progress !== null) await bb.storage.kv.set("flow-progress:thr_1", progress);
  registerApi(bb, store, { now: () => "2026-10-22T06:05:00.000Z", progress: createProgress(bb.storage.kv) });
  return (await harness.callRpc("getBrief", { id: brief.id })) as { kind: string; idleAfter?: true };
};

describe("getBrief говорит виджету, что после ответа агенту делать нечего", () => {
  it("за утверждением только автоматизации и Action — idleAfter", async () => {
    const found = await getBrief(approval([work, approve, merge, action]), { stages: { implement: { finishedAt: DONE } }, waiting: ["approve"] });
    expect(found.idleAfter).toBe(true);
  });

  it("за утверждением незакрытый этап агента — признака нет", async () => {
    const found = await getBrief(approval([approve, work, merge]), { stages: {}, waiting: ["approve"] });
    expect(found.idleAfter).toBeUndefined();
  });

  it("этап агента за утверждением вычеркнут из прогона — idleAfter", async () => {
    const found = await getBrief(approval([approve, work, merge]), { stages: { implement: { skipped: true } }, waiting: ["approve"] });
    expect(found.idleAfter).toBe(true);
  });

  it("бриф без итога — работа агента впереди, признака нет", async () => {
    const { outcome: _outcome, ...setup } = approval([work, merge]);
    expect((await getBrief(setup, { stages: {}, waiting: [] })).idleAfter).toBeUndefined();
  });

  it("у треда нет записи прогона — о работе впереди ничего не известно, признака нет", async () => {
    expect((await getBrief(approval([work, approve, merge]), null)).idleAfter).toBeUndefined();
  });
});
