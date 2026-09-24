// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { registerApi } from "./api";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_active";
const settings: StageSettings = { stages: [builtinStage("questions", []), stage("task", { name: "Задача" }), builtinStage("demo", [])], minButtonWidth: 170 };

type Row = { id: string; state: string; number: number | null; minutes: number | null; wallMinutes: number | null };

const host = async () => {
  let clock = Date.parse("2026-09-16T10:00:00.000Z");
  const now = () => new Date(clock).toISOString();
  const tick = (minutes: number) => {
    clock += minutes * 60_000;
  };
  const calls: number[] = [];
  const woken: string[] = [];
  /** `null` — лог не прочитался: минут нет и запоминать нечего. */
  let active: number | null = null;
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => woken.push(threadId) });
  registerAskTool(bb, store, { newId: () => "A1", now, stages: () => settings, progress });
  registerApi(bb, store, { now, progress });
  registerProgress(bb, progress, {
    now,
    stages: () => settings,
    windowCost: async () => 1.8,
    windowMinutes: async (_threadId, windows) => {
      calls.push(windows.length);
      if (active === null) throw new Error("лог не прочитан");
      return windows.map(() => active!);
    },
  });
  const rows = async (): Promise<Row[]> => ((await harness.callRpc("getFlowProgress", { threadId: THREAD })) as { stages: Row[] }).stages;
  return { harness, tick, calls, woken, rows, setActive: (value: number | null) => { active = value; } };
};

const started = async (h: Awaited<ReturnType<typeof host>>) => {
  await h.harness.callAgentTool(ASK_TOOL_NAME, { title: "Бриф", setup: { stages: [{ id: "questions", state: "todo" }, { id: "task", state: "todo", recommended: true }, { id: "demo", state: "todo", recommended: true }] } }, { threadId: THREAD });
  await h.harness.callRpc("answerBrief", { id: "dec_A1", messageId: "m", answer: { briefId: "dec_A1", answers: [], stages: [{ id: "task", run: true, executor: "self" }, { id: "demo", run: true, executor: "self" }] } });
  await h.harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "started" }, { threadId: THREAD });
  h.tick(12);
};

describe("активные минуты этапа на сервере", () => {
  it("конец этапа пишет активные минуты окна, стенные часы остаются рядом", async () => {
    const h = await host();
    h.setActive(4);
    await started(h);
    await h.harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "done" }, { threadId: THREAD });
    expect((await h.rows()).find((s) => s.id === "task")).toMatchObject({ minutes: 4, wallMinutes: 12 });
  });

  it("этап, закрытый без минут, добирает их одним чтением на опросе и больше лог не читает", async () => {
    const h = await host();
    await started(h);
    await h.harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "done" }, { threadId: THREAD });
    expect((await h.rows()).find((s) => s.id === "task")).toMatchObject({ minutes: 12, wallMinutes: 12 });
    h.setActive(4);
    expect((await h.rows()).find((s) => s.id === "task")).toMatchObject({ minutes: 4, wallMinutes: 12 });
    const before = h.calls.length;
    expect((await h.rows()).find((s) => s.id === "task")).toMatchObject({ minutes: 4 });
    expect(h.calls.length).toBe(before);
  });

  it("добор на опросе не будит исполнителя автоматизаций: опрос — чтение, а не правка хода работы", async () => {
    const h = await host();
    await started(h);
    await h.harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "done" }, { threadId: THREAD });
    h.setActive(4);
    const before = h.woken.length;
    expect((await h.rows()).find((s) => s.id === "task")).toMatchObject({ minutes: 4 });
    expect(h.woken.length).toBe(before);
  });

  it("строки прогона пронумерованы по порядку", async () => {
    const h = await host();
    h.setActive(0);
    await started(h);
    expect((await h.rows()).map((s) => s.number)).toEqual([1, 2, 3]);
  });
});
