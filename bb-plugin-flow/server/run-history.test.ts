// @vitest-environment node
// История прогонов: итог замораживается в момент завершения прогона — без опроса баннера — и отдаётся списком.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { registerApi } from "./api";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { FLOW_STAGE_TOOL, createProgress, registerProgress, type ThreadState } from "./progress";
import { createStore } from "./store";

const settings: StageSettings = { stages: [builtinStage("questions", []), stage("task", { name: "Задача" })], minButtonWidth: 170 };

type Entry = { briefId: string; threadId: string; title: string | null; exists: boolean; flowName?: string; summary: { finishedAt: string }; stages: unknown[] };

/** Сборка как в server.ts: каждая правка прогона пробует заморозить его итог. */
const host = async (titles: Record<string, string> = {}) => {
  let clock = Date.parse("2026-09-19T10:00:00.000Z");
  const now = () => new Date(clock).toISOString();
  const tick = (minutes: number) => {
    clock += minutes * 60_000;
  };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  let freeze: (threadId: string) => Promise<void> = async () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => void freeze(threadId) });
  let briefs = 0;
  registerAskTool(bb, store, { newId: () => `run${++briefs}`, now, stages: () => settings, progress });
  registerApi(bb, store, { now, progress });
  const thread = async (threadId: string): Promise<ThreadState> => {
    const title = titles[threadId];
    if (title === undefined) throw new Error("thread not found");
    return { environmentId: null, active: false, providerId: null, title };
  };
  freeze = registerProgress(bb, progress, { now, stages: () => settings, flowName: () => "Разработка", windowCost: async () => 2.5, thread }).freezeFinished;
  return { bb, harness, tick, progress };
};

/** Прогон треда от брифа до закрытой Задачи. */
const runThrough = async ({ harness, tick }: Awaited<ReturnType<typeof host>>, threadId: string, briefId: string) => {
  await harness.callAgentTool(ASK_TOOL_NAME, { title: "Бриф", setup: { stages: [{ id: "questions", state: "todo" }, { id: "task", state: "todo", recommended: true }] } }, { threadId });
  await harness.callRpc("answerBrief", { id: briefId, messageId: "m", answer: { briefId, answers: [], stages: [{ id: "task", run: true, executor: "self" }] } });
  await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "started" }, { threadId });
  tick(20);
  await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "done", results: [{ label: "spec.md", target: "docs/specs/spec.md" }] }, { threadId });
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("заморозка итога без баннера", () => {
  it("прогон, закрытый отметкой этапа, замораживается, хотя баннер его ни разу не опросил", async () => {
    const h = await host({ thr_a: "Тред А" });
    await runThrough(h, "thr_a", "dec_run1");
    await settle();
    expect(await h.harness.callRpc("getRunSummary", { briefId: "dec_run1" })).toMatchObject({ threadId: "thr_a", flowName: "Разработка", total: 2 });
  });

  it("незавершённый прогон не замораживается", async () => {
    const h = await host({ thr_a: "Тред А" });
    await h.harness.callAgentTool(ASK_TOOL_NAME, { title: "Бриф", setup: { stages: [{ id: "questions", state: "todo" }, { id: "task", state: "todo", recommended: true }] } }, { threadId: "thr_a" });
    await h.harness.callRpc("answerBrief", { id: "dec_run1", messageId: "m", answer: { briefId: "dec_run1", answers: [], stages: [{ id: "task", run: true, executor: "self" }] } });
    await settle();
    expect(await h.harness.callRpc("getRunSummary", { briefId: "dec_run1" })).toBeNull();
    expect(await h.harness.callRpc("getRunHistory", {})).toEqual([]);
  });

  it("итог переживает снятие записи прогона — следующий прогон треда", async () => {
    const h = await host({ thr_a: "Тред А" });
    await runThrough(h, "thr_a", "dec_run1");
    await settle();
    await h.progress.remove("thr_a");
    expect(((await h.harness.callRpc("getRunHistory", {})) as Entry[]).map((e) => e.briefId)).toEqual(["dec_run1"]);
  });
});

describe("список истории", () => {
  it("все завершённые прогоны, свежие сверху, с названием треда и брифом", async () => {
    const h = await host({ thr_a: "Тред А", thr_b: "Тред Б" });
    await runThrough(h, "thr_a", "dec_run1");
    h.tick(60);
    await runThrough(h, "thr_b", "dec_run2");
    await settle();
    const list = (await h.harness.callRpc("getRunHistory", {})) as Entry[];
    expect(list.map((e) => [e.briefId, e.threadId, e.title, e.exists])).toEqual([
      ["dec_run2", "thr_b", "Тред Б", true],
      ["dec_run1", "thr_a", "Тред А", true],
    ]);
    expect(list[0]!.stages).toHaveLength(2);
  });

  it("тред, которого больше нет, — строка без названия и с exists: false", async () => {
    const h = await host({ thr_a: "Тред А" });
    await runThrough(h, "thr_a", "dec_run1");
    await settle();
    const [gone] = await (async () => {
      const titles = await host({});
      await titles.bb.storage.kv.set("flow-run:dec_gone", await h.harness.callRpc("getRunSummary", { briefId: "dec_run1" }));
      return (await titles.harness.callRpc("getRunHistory", {})) as Entry[];
    })();
    expect(gone).toMatchObject({ briefId: "dec_gone", threadId: "thr_a", title: null, exists: false });
  });

  it("битая запись итога список не роняет", async () => {
    const h = await host({ thr_a: "Тред А" });
    await runThrough(h, "thr_a", "dec_run1");
    await settle();
    await h.bb.storage.kv.set("flow-run:dec_broken", { threadId: 42 });
    expect(((await h.harness.callRpc("getRunHistory", {})) as Entry[]).map((e) => e.briefId)).toEqual(["dec_run1"]);
  });
});
