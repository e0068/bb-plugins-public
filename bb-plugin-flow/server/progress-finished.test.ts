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

const THREAD = "thr_finished";
const settings: StageSettings = { stages: [builtinStage("questions", []), stage("task", { name: "Задача" })], minButtonWidth: 170 };

const host = async () => {
  let clock = Date.parse("2026-09-19T10:00:00.000Z");
  const now = () => new Date(clock).toISOString();
  const tick = (minutes: number) => {
    clock += minutes * 60_000;
  };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  const progress = createProgress(bb.storage.kv);
  registerAskTool(bb, store, { newId: () => "run", now, stages: () => settings, progress });
  registerApi(bb, store, { now, progress });
  registerProgress(bb, progress, { now, stages: () => settings, windowCost: async () => 2.5 });
  return { harness, tick };
};

/** Бриф со всеми этапами прогона: Вопросы закрываются им самим, Задача уходит в прогон. */
const brief = { title: "Бриф", setup: { stages: [{ id: "questions", state: "todo" }, { id: "task", state: "todo", recommended: true }] } };

const answer = { briefId: "dec_run", answers: [], stages: [{ id: "task", run: true, executor: "self" }] };

describe("завершённый прогон в ответе баннера", () => {
  it("пока этап открыт — прогон не завершён и итога нет", async () => {
    const { harness } = await host();
    await harness.callAgentTool(ASK_TOOL_NAME, brief, { threadId: THREAD });
    await harness.callRpc("answerBrief", { id: "dec_run", messageId: "m", answer });
    expect(await harness.callRpc("getFlowProgress", { threadId: THREAD })).toMatchObject({ finished: false, summary: null });
  });

  it("последний этап закрыт — прогон завершён, итог посчитан и назван бриф под ним", async () => {
    const { harness, tick } = await host();
    await harness.callAgentTool(ASK_TOOL_NAME, brief, { threadId: THREAD });
    await harness.callRpc("answerBrief", { id: "dec_run", messageId: "m", answer });
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "started" }, { threadId: THREAD });
    tick(20);
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "done", results: [{ label: "spec.md", target: "docs/specs/spec.md" }] }, { threadId: THREAD });
    const view = (await harness.callRpc("getFlowProgress", { threadId: THREAD })) as { finished: boolean; summaryBriefId: string; summary: { stages: number; cost: number; executors: unknown[] } };
    expect(view.finished).toBe(true);
    expect(view.summaryBriefId).toBe("dec_run");
    expect(view.summary).toMatchObject({ stages: 2, cost: 2.5 });
    expect(view.summary.executors).toHaveLength(1);
  });
});

describe("итог, замороженный под брифом", () => {
  it("итог доступен по брифу и переживает следующий прогон", async () => {
    const { harness, tick } = await host();
    await harness.callAgentTool(ASK_TOOL_NAME, brief, { threadId: THREAD });
    await harness.callRpc("answerBrief", { id: "dec_run", messageId: "m", answer });
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "started" }, { threadId: THREAD });
    tick(20);
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "done", results: [{ label: "spec.md", target: "docs/specs/spec.md" }] }, { threadId: THREAD });
    await harness.callRpc("getFlowProgress", { threadId: THREAD });
    const frozen = (await harness.callRpc("getRunSummary", { briefId: "dec_run" })) as { summary: { stages: number }; stages: unknown[]; total: number };
    expect(frozen.summary.stages).toBe(2);
    expect(frozen.stages).toHaveLength(2);
    expect(frozen.total).toBe(2);
  });

  it("под брифом без завершённого прогона итога нет", async () => {
    const { harness } = await host();
    expect(await harness.callRpc("getRunSummary", { briefId: "dec_none" })).toBeNull();
  });
});
