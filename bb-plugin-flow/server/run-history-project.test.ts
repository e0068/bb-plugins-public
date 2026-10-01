// @vitest-environment node
// Строка истории прогонов несёт название проекта, в котором идёт тред.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { registerApi } from "./api";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { FLOW_STAGE_TOOL, createProgress, registerProgress, type ThreadState } from "./progress";
import { createStore } from "./store";
import { priced } from "./priced-fixture";

const settings: StageSettings = { stages: [builtinStage("questions", []), stage("task", { name: "Задача" })], minButtonWidth: 170 };

type Entry = { briefId: string; project: string | null };

/** Тред — `[проект, заголовок]`; тред, которого нет в списке, удалён. */
const host = async (threads: Record<string, [projectId: string, title: string]>, projects: ReadonlyArray<{ id: string; name: string }>) => {
  let clock = Date.parse("2026-09-19T10:00:00.000Z");
  const now = () => new Date(clock).toISOString();
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  let freeze: (threadId: string) => Promise<void> = async () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => void freeze(threadId) });
  let briefs = 0;
  let projectReads = 0;
  registerAskTool(bb, store, { newId: () => `run${++briefs}`, now, stages: () => settings, progress });
  registerApi(bb, store, { now, progress });
  const thread = async (threadId: string): Promise<ThreadState> => {
    const found = threads[threadId];
    if (found === undefined) throw new Error("thread not found");
    return { environmentId: null, active: false, providerId: null, title: found[1], projectId: found[0] };
  };
  const listProjects = async () => {
    projectReads += 1;
    return projects;
  };
  freeze = registerProgress(bb, progress, { now, stages: () => settings, flowName: () => "Разработка", windowCost: async () => 2.5, thread, projects: listProjects }).freezeFinished;
  const run = async (threadId: string, briefId: string) => {
    await harness.callAgentTool(ASK_TOOL_NAME, priced({ title: "Бриф", setup: { stages: [{ id: "questions", state: "todo" }, { id: "task", state: "todo", recommended: true }] } }), { threadId });
    await harness.callRpc("answerBrief", { id: briefId, messageId: "m", answer: { briefId, answers: [], stages: [{ id: "task", run: true, executor: "self" }] } });
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "started" }, { threadId });
    clock += 20 * 60_000;
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "done" }, { threadId });
    await new Promise((resolve) => setTimeout(resolve, 20));
  };
  const history = async () => (await harness.callRpc("getRunHistory", {})) as Entry[];
  return { run, history, reads: () => projectReads, forget: (threadId: string) => delete threads[threadId] };
};

const PROJECTS = [
  { id: "prj_bb", name: "bb-plugins" },
  { id: "prj_cell", name: "Cellular" },
];

describe("проект в истории прогонов", () => {
  it("строка несёт название проекта своего треда", async () => {
    const h = await host({ thr_a: ["prj_bb", "Тред А"], thr_b: ["prj_cell", "Тред Б"] }, PROJECTS);
    await h.run("thr_a", "dec_run1");
    await h.run("thr_b", "dec_run2");
    const byBrief = Object.fromEntries((await h.history()).map((e) => [e.briefId, e.project]));
    expect(byBrief).toEqual({ dec_run1: "bb-plugins", dec_run2: "Cellular" });
  });

  it("у удалённого треда проекта нет, строка остаётся", async () => {
    const h = await host({ thr_a: ["prj_bb", "Тред А"] }, PROJECTS);
    await h.run("thr_a", "dec_run1");
    h.forget("thr_a");
    expect(await h.history()).toMatchObject([{ briefId: "dec_run1", project: null }]);
  });

  it("проект, которого нет в списке проектов, — строка без проекта", async () => {
    const h = await host({ thr_a: ["prj_gone", "Тред А"] }, PROJECTS);
    await h.run("thr_a", "dec_run1");
    expect(await h.history()).toMatchObject([{ briefId: "dec_run1", project: null }]);
  });

  it("список проектов читается один раз на запрос истории, сколько бы строк ни было", async () => {
    const h = await host({ thr_a: ["prj_bb", "Тред А"], thr_b: ["prj_cell", "Тред Б"] }, PROJECTS);
    await h.run("thr_a", "dec_run1");
    await h.run("thr_b", "dec_run2");
    const before = h.reads();
    await h.history();
    expect(h.reads() - before).toBe(1);
  });
});
