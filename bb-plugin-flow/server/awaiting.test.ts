// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { registerApi } from "./api";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const settings: StageSettings = { stages: [builtinStage("select", []), stage("task"), builtinStage("demo", [])], minButtonWidth: 170 };

const host = async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  let n = 0;
  registerAskTool(bb, store, { newId: () => `A${++n}`, now: () => "2026-09-16T10:00:00.000Z", stages: () => settings });
  registerApi(bb, store, { now: () => "2026-09-16T10:01:00.000Z" });
  const ask = (threadId: string, input: unknown) => harness.callAgentTool(ASK_TOOL_NAME, input, { threadId });
  return { harness, store, ask };
};

const selectBrief = { title: "Выбор", setup: { stages: [{ id: "select", state: "todo" }, { id: "task", state: "todo", recommended: true }, { id: "demo", state: "todo", recommended: true }] } };
const clarify = { title: "Тема", kind: "clarify", questions: [{ id: "q", kind: "yesno", question: "Светлую?", options: [{ id: "yes", action: "Да" }, { id: "no", action: "Нет" }] }] };

describe("ждущие владельца треды", () => {
  it("бриф ставит тред ждать с видом, уточнение — нет, ответ снимает", async () => {
    const { harness, ask } = await host();
    await ask("thr_a", selectBrief);
    await ask("thr_b", clarify);
    expect(await harness.callRpc("awaitingThreads", {})).toEqual([{ threadId: "thr_a", kind: "select" }]);
    await harness.callRpc("answerBrief", { id: "dec_A1", messageId: "m", answer: { briefId: "dec_A1", answers: [], stages: [{ id: "task", run: true, executor: "self" }] } });
    expect(await harness.callRpc("awaitingThreads", {})).toEqual([]);
  });

  it("ответ на старый бриф не снимает ожидание нового брифа того же треда", async () => {
    const { harness, ask, store } = await host();
    await ask("thr_a", selectBrief);
    await store.putAwaiting("thr_a", { briefId: "dec_newer", kind: "demo" });
    await harness.callRpc("answerBrief", { id: "dec_A1", messageId: "m", answer: { briefId: "dec_A1", answers: [], stages: [{ id: "task", run: true, executor: "self" }] } });
    expect(await harness.callRpc("awaitingThreads", {})).toEqual([{ threadId: "thr_a", kind: "demo" }]);
  });
});
