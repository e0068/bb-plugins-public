// @vitest-environment node
// Итог прогона — в истории и под брифом — несёт файлы журнала, которые прогон оставил в дереве треда.
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

type Journal = (threadId: string, window: { startedAt: string; finishedAt: string }) => Promise<readonly string[]>;

const host = async (journal?: Journal) => {
  let clock = Date.parse("2026-09-19T10:00:00.000Z");
  const now = () => new Date(clock).toISOString();
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  let freeze: (threadId: string) => Promise<void> = async () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => void freeze(threadId) });
  let ids = 0;
  registerAskTool(bb, store, { newId: () => `run${++ids}`, now, stages: () => settings, progress });
  registerApi(bb, store, { now, progress });
  const thread = async (): Promise<ThreadState> => ({ environmentId: "env_a", active: false, providerId: null, title: "Тред А", projectId: "prj" });
  freeze = registerProgress(bb, progress, { now, stages: () => settings, flowName: () => "Code", windowCost: async () => 1, thread, ...(journal === undefined ? {} : { journal }) }).freezeFinished;
  await harness.callAgentTool(ASK_TOOL_NAME, { title: "Бриф", setup: { stages: [{ id: "questions", state: "todo" }, { id: "task", state: "todo", recommended: true }] } }, { threadId: "thr_a" });
  await harness.callRpc("answerBrief", { id: "dec_run1", messageId: "m", answer: { briefId: "dec_run1", answers: [], stages: [{ id: "task", run: true, executor: "self" }] } });
  await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "started" }, { threadId: "thr_a" });
  clock += 20 * 60_000;
  await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "done" }, { threadId: "thr_a" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  return harness;
};

describe("журнал в итоге прогона", () => {
  it("строка истории и итог под брифом несут файлы журнала своего треда за окно прогона", async () => {
    const asked: Array<{ threadId: string; startedAt: string; finishedAt: string }> = [];
    const harness = await host(async (threadId, window) => {
      asked.push({ threadId, ...window });
      return ["docs/flows/brif.md", "docs/flows/demo.md"];
    });
    const [row] = (await harness.callRpc("getRunHistory", {})) as Array<{ journal?: string[]; summary: { startedAt: string; finishedAt: string } }>;
    expect(row?.journal).toEqual(["docs/flows/brif.md", "docs/flows/demo.md"]);
    expect(asked[0]).toEqual({ threadId: "thr_a", startedAt: row?.summary.startedAt, finishedAt: row?.summary.finishedAt });
    expect(await harness.callRpc("getRunSummary", { briefId: "dec_run1" })).toMatchObject({ journal: ["docs/flows/brif.md", "docs/flows/demo.md"] });
  });

  it("журнал не прочитался — итог приходит без него, а не падает", async () => {
    const harness = await host(async () => {
      throw new Error("kv unavailable");
    });
    const [row] = (await harness.callRpc("getRunHistory", {})) as Array<Record<string, unknown>>;
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("journal");
  });
});
