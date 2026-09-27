// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import { builtinStage } from "../lib/stage-constants";
import type { FrozenRun, StageSettings } from "../shared/contract";
import { registerApi } from "./api";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_titled";
const settings: StageSettings = { stages: [builtinStage("questions", []), stage("task", { name: "Задача" })], minButtonWidth: 170 };
const brief = { title: "Бриф", setup: { stages: [{ id: "questions", state: "todo" }, { id: "task", state: "todo", recommended: true }] } };
const answer = { briefId: "dec_run", answers: [], stages: [{ id: "task", run: true, executor: "self" }] };

/** Прогон из одного этапа Задача, закрытого с этими результатами; `files` — тексты файлов дерева треда по пути. */
const finishedRun = async (results: unknown[], files: Record<string, string>): Promise<FrozenRun> => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  const progress = createProgress(bb.storage.kv);
  const now = () => "2026-09-24T10:00:00.000Z";
  registerAskTool(bb, store, { newId: () => "run", now, stages: () => settings, progress });
  registerApi(bb, store, { now, progress });
  const readTaskFile = async (threadId: string, target: string) => (threadId === THREAD && target in files ? files[target] : Promise.reject(new Error("ENOENT")));
  registerProgress(bb, progress, { now, stages: () => settings, windowCost: async () => 1, readTaskFile });
  await harness.callAgentTool(ASK_TOOL_NAME, brief, { threadId: THREAD });
  await harness.callRpc("answerBrief", { id: "dec_run", messageId: "m", answer });
  await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "started" }, { threadId: THREAD });
  await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "done", results }, { threadId: THREAD });
  await harness.callRpc("getFlowProgress", { threadId: THREAD });
  return (await harness.callRpc("getRunSummary", { briefId: "dec_run" })) as FrozenRun;
};

const taskResults = (run: FrozenRun) => run.stages.find((s) => s.id === "task")!.results;

describe("название задачи в результатах этапа", () => {
  it("этап, закрытый файлом задачи, запоминает её название из шапки файла", async () => {
    const target = "docs/tasks/in_progress/flow-itog.md";
    const run = await finishedRun([{ label: "flow-itog", target }], { [target]: "---\ntitle: Flow — итог прогона\n---\n" });
    expect(taskResults(run)).toEqual([{ label: "flow-itog", target, title: "Flow — итог прогона" }]);
  });

  it("файлы не задач не читаются и названия не получают", async () => {
    const target = "docs/specs/spec.md";
    const run = await finishedRun([{ label: "spec.md", target }], { [target]: "---\ntitle: Спека\n---\n" });
    expect(taskResults(run)).toEqual([{ label: "spec.md", target }]);
  });

  it("нечитаемый файл задачи не мешает отметке: результат остаётся без названия", async () => {
    const target = "docs/tasks/done/gone.md";
    const run = await finishedRun([{ label: "BBPL-9", target }], {});
    expect(taskResults(run)).toEqual([{ label: "BBPL-9", target }]);
  });

  it("название пишет только Flow: присланное агентом в результате не сохраняется", async () => {
    const target = "docs/specs/spec.md";
    const run = await finishedRun([{ label: "spec.md", target, title: "От агента" }], {});
    expect(taskResults(run)).toEqual([{ label: "spec.md", target }]);
  });
});
