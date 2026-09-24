// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import type { FlowProgress, ProgressView, StageSettings } from "../shared/contract";
import { createProgress, FLOW_STAGE_TOOL, registerProgress } from "./progress";

const at = "2026-09-23T15:00:00.000Z";
const flowOf = (ids: string[]): StageSettings => ({ stages: ids.map((id) => stage(id)), minButtonWidth: 170 });
const flows: Record<string, StageSettings> = { thr_src: flowOf(["review", "demo"]), thr_new: flowOf(["review", "demo", "land"]) };
const names: Record<string, string> = { thr_src: "Старый flow", thr_new: "Flow соседа" };
const titles: Record<string, string> = { thr_new: "Пороги — ошибка на вводе" };

const viewOf = async (harness: { callRpc: (method: string, input: unknown) => Promise<unknown> }, threadId: string) => (await harness.callRpc("getFlowProgress", { threadId })) as ProgressView | null;

const setup = async (seeded: Record<string, FlowProgress> = {}, handedTo: Record<string, string> = {}) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  await Promise.all(Object.entries(seeded).map(([threadId, record]) => bb.storage.kv.set(`flow-progress:${threadId}`, record)));
  const progress = createProgress(bb.storage.kv, { handedTo: async (briefId) => handedTo[briefId] });
  registerProgress(bb, progress, {
    now: () => at,
    stages: (threadId) => flows[threadId] ?? flowOf([]),
    flowName: (threadId) => names[threadId],
    windowCost: async () => undefined,
    thread: async (threadId) => ({ environmentId: `env_${threadId}`, active: false, providerId: null, title: titles[threadId] ?? null }),
  });
  return { progress, harness };
};

const handedOver = async () => {
  const { progress, harness } = await setup();
  await progress.update("thr_src", () => ({ stages: { review: { startedAt: at, finishedAt: at }, demo: { startedAt: at } }, waiting: [] }));
  await progress.handOver("thr_src", "thr_new", [{ id: "demo", run: true, executor: "self" }]);
  return { progress, harness };
};

describe("баннер треда, который отдал работу", () => {
  it("показывает прогон по этапам, имени flow и окружению носителя и называет носителя", async () => {
    const { harness } = await handedOver();
    const view = await viewOf(harness, "thr_src");
    expect(view?.stages.map((s) => s.id)).toEqual(["review", "demo", "land"]);
    expect(view?.flowName).toBe("Flow соседа");
    expect(view?.environmentId).toBe("env_thr_new");
    expect(view?.carrier).toEqual({ threadId: "thr_new", title: "Пороги — ошибка на вводе" });
  });

  it("у носителя строки о передаче нет", async () => {
    const { harness } = await handedOver();
    expect((await viewOf(harness, "thr_new"))?.carrier).toBeUndefined();
  });

  it("отметка этапа из треда, отдавшего работу, отклоняется и не двигает прогон", async () => {
    const { progress, harness } = await handedOver();
    const before = await progress.get("thr_new");
    const answer = await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "demo", state: "started" }, { threadId: "thr_src" });
    expect(JSON.stringify(answer)).toContain("thr_new");
    expect(await progress.get("thr_new")).toEqual(before);
  });
});

describe("тред, переданный до правки", () => {
  // Пара записей как у thr_yx2vkdfzwr: исходный застыл на Демонстрации, сосед прошёл весь прогон.
  const stale: FlowProgress = { stages: { review: { startedAt: at, finishedAt: at }, demo: { startedAt: at } }, waiting: [], lastBriefId: "dec_src" };
  const done: FlowProgress = { stages: { review: { startedAt: at, finishedAt: at }, demo: { startedAt: at, finishedAt: at }, land: { startedAt: at, finishedAt: at } }, waiting: [], lastBriefId: "dec_new" };

  it("показывает прогон соседа закрытым и ни на одном этапе не ждёт", async () => {
    const { harness } = await setup({ thr_src: stale, thr_new: done }, { dec_src: "thr_new" });
    const view = await viewOf(harness, "thr_src");
    expect(view?.carrier?.threadId).toBe("thr_new");
    expect(view?.finished).toBe(true);
    expect(view?.stages.filter((s) => s.state === "now")).toEqual([]);
  });
});
