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

const THREAD = "thr_flowed";
const settings: StageSettings = { stages: [builtinStage("questions", []), stage("task", { name: "Задача" })], minButtonWidth: 170 };
const brief = { title: "Бриф", setup: { stages: [{ id: "questions", state: "todo" }, { id: "task", state: "todo", recommended: true }] } };
const answer = { briefId: "dec_run", answers: [], stages: [{ id: "task", run: true, executor: "self" }] };
const CODE = { id: "flow-code", name: "Code" };

/** Этап Задача закрыт с результатами; возвращает дерево треда после отметки. */
const markTask = async (results: unknown[], files: Record<string, string>, flow: typeof CODE | undefined) => {
  const tree = { ...files };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  const progress = createProgress(bb.storage.kv);
  const now = () => "2026-09-25T10:00:00.000Z";
  registerAskTool(bb, store, { newId: () => "run", now, stages: () => settings, progress });
  registerApi(bb, store, { now, progress });
  const readTaskFile = async (_threadId: string, target: string) => (target in tree ? tree[target]! : Promise.reject(new Error("ENOENT")));
  const writeTaskFile = async (_threadId: string, target: string, text: string) => {
    tree[target] = text;
  };
  registerProgress(bb, progress, { now, stages: () => settings, windowCost: async () => 1, readTaskFile, writeTaskFile, flow: () => flow });
  await harness.callAgentTool(ASK_TOOL_NAME, brief, { threadId: THREAD });
  await harness.callRpc("answerBrief", { id: "dec_run", messageId: "m", answer });
  await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "started" }, { threadId: THREAD });
  const reply = await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "done", results }, { threadId: THREAD });
  return { tree, reply };
};

const TASK = "docs/tasks/in_progress/zadacha.md";

describe("flow треда в файле задачи", () => {
  it("этап, закрытый файлом задачи в треде с flow, пишет в шапку блок flow", async () => {
    const { tree } = await markTask([{ label: "zadacha", target: TASK }], { [TASK]: "---\ntitle: Задача\n---\nТело\n" }, CODE);
    expect(tree[TASK]).toBe('---\ntitle: Задача\nflow:\n  id: flow-code\n  name: "Code"\n---\nТело\n');
  });

  it("тред без flow файл задачи не трогает", async () => {
    const { tree } = await markTask([{ label: "zadacha", target: TASK }], { [TASK]: "---\ntitle: Задача\n---\n" }, undefined);
    expect(tree[TASK]).toBe("---\ntitle: Задача\n---\n");
  });

  it("файлы не задач не штампуются", async () => {
    const spec = "docs/specs/zadacha.md";
    const { tree } = await markTask([{ label: "zadacha.md", target: spec }], { [spec]: "---\ntitle: Спека\n---\n" }, CODE);
    expect(tree[spec]).toBe("---\ntitle: Спека\n---\n");
  });

  it("нечитаемый файл задачи не мешает отметке и не создаётся", async () => {
    const { tree, reply } = await markTask([{ label: "zadacha", target: TASK }], {}, CODE);
    expect(JSON.stringify(reply)).toContain("marked done");
    expect(tree).toEqual({});
  });
});
