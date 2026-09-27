// @vitest-environment node
// Строка истории несёт id flow, пока flow жив: по нему название flow в строке ведёт на его страницу.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { liveFlowId } from "../core/run-history";
import { stage } from "../core/stages-fixtures";
import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { registerApi } from "./api";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const settings: StageSettings = { stages: [builtinStage("questions", []), stage("task", { name: "Задача" })], minButtonWidth: 170 };

/** Прогон треда до конца под flow `flow` и история при живых `live`. */
const history = async (flow: { id: string; name: string } | undefined, flowName: string | undefined, live: ReadonlyArray<{ id: string; name: string }>) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  const progress = createProgress(bb.storage.kv);
  const now = () => "2026-09-25T10:00:00.000Z";
  registerAskTool(bb, store, { newId: () => "run", now, stages: () => settings, progress });
  registerApi(bb, store, { now, progress });
  registerProgress(bb, progress, {
    now,
    stages: () => settings,
    windowCost: async () => 1,
    flowName: () => flowName,
    flow: () => flow,
    liveFlowId: (id, name) => liveFlowId(live, id, name),
  });
  await harness.callAgentTool(ASK_TOOL_NAME, { title: "Бриф", setup: { stages: [{ id: "questions", state: "todo" }, { id: "task", state: "todo", recommended: true }] } }, { threadId: "thr_a" });
  await harness.callRpc("answerBrief", { id: "dec_run", messageId: "m", answer: { briefId: "dec_run", answers: [], stages: [{ id: "task", run: true, executor: "self" }] } });
  await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "started" }, { threadId: "thr_a" });
  await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "done" }, { threadId: "thr_a" });
  await harness.callRpc("getFlowProgress", { threadId: "thr_a" });
  return (await harness.callRpc("getRunHistory", {})) as Array<{ flowId?: string; flowName?: string }>;
};

const CODE = { id: "flow-code", name: "Code" };

describe("id flow в истории прогонов", () => {
  it("итог хранит id flow треда, и живой flow отдаётся строке истории", async () => {
    expect(await history(CODE, "Code", [CODE])).toMatchObject([{ flowId: "flow-code", flowName: "Code" }]);
  });

  it("итог без id — строка получает id живого flow с тем же названием", async () => {
    expect(await history(undefined, "Code", [CODE])).toMatchObject([{ flowId: "flow-code", flowName: "Code" }]);
  });

  it("flow удалён — строка остаётся без id", async () => {
    const [row] = await history(CODE, "Code", []);
    expect(row).not.toHaveProperty("flowId");
  });
});
