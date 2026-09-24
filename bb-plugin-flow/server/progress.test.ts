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

const THREAD = "thr_progress";
const settings: StageSettings = { stages: [builtinStage("questions", []), builtinStage("select", []), stage("task", { name: "Задача" }), builtinStage("demo", [])], minButtonWidth: 170 };

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

const host = async (cost?: number) => {
  let clock = Date.parse("2026-09-16T10:00:00.000Z");
  const now = () => new Date(clock).toISOString();
  const tick = (minutes: number) => {
    clock += minutes * 60_000;
  };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  const progress = createProgress(bb.storage.kv);
  registerAskTool(bb, store, { newId: () => "P1", now, stages: () => settings, progress });
  registerApi(bb, store, { now, progress });
  registerProgress(bb, progress, { now, stages: () => settings, windowCost: async () => cost });
  return { harness, tick };
};

const stagesBrief = { title: "Бриф", setup: { stages: [{ id: "questions", state: "todo" }, { id: "select", state: "todo" }, { id: "task", state: "todo", recommended: true }, { id: "demo", state: "todo", recommended: true }] } };

describe("прогресс flow на сервере", () => {
  it("у треда без брифа flow прогресса нет", async () => {
    const { harness } = await host();
    expect(await harness.callRpc("getFlowProgress", { threadId: THREAD })).toBeNull();
  });

  it("бриф, ответ и отметки агента ведут этапы; конец этапа пишет минуты и стоимость окна", async () => {
    const { harness, tick } = await host(1.8);
    await harness.callAgentTool(ASK_TOOL_NAME, stagesBrief, { threadId: THREAD });
    expect(await harness.callRpc("getFlowProgress", { threadId: THREAD })).toMatchObject({ current: "questions", done: 0, total: 4 });
    tick(3);
    await harness.callRpc("answerBrief", { id: "dec_P1", messageId: "m", answer: { briefId: "dec_P1", answers: [], stages: [{ id: "task", run: true, executor: "self" }, { id: "demo", run: true, executor: "self" }] } });
    expect(await harness.callRpc("getFlowProgress", { threadId: THREAD })).toMatchObject({ current: "task", done: 2 });
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "started" }, { threadId: THREAD });
    tick(12);
    const link = { label: "task.md", target: "docs/tasks/task.md" };
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "done", results: [link] }, { threadId: THREAD });
    const view = (await harness.callRpc("getFlowProgress", { threadId: THREAD })) as { stages: Array<{ id: string; state: string; minutes: number | null; cost: number | null }>; current: string | null };
    expect(view.stages.find((s) => s.id === "task")).toMatchObject({ state: "done", minutes: 12, cost: 1.8 });
    expect(view.current).toBe("demo");
  });

  it("отметка этапа не из flow треда — ошибка со списком этапов", async () => {
    const { harness } = await host();
    expect(textOf(await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "ghost", state: "started" }, { threadId: THREAD }))).toMatch(/questions, select, task, demo/);
  });

  it("инструмент отметки объясняет, когда его звать, и помещается в 4096 символов", async () => {
    const { harness } = await host();
    const tool = harness.registrations.agentTools.find((t) => t.name === FLOW_STAGE_TOOL);
    expect(tool?.instructions).toMatch(/started/);
    expect((tool?.instructions ?? "").length).toBeLessThanOrEqual(4096);
  });
});
