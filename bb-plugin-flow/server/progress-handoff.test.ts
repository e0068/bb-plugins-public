// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { registerApi } from "./api";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const settings: StageSettings = { stages: [builtinStage("select", []), stage("task")], minButtonWidth: 170 };

describe("передача работы в новый тред", () => {
  it("новый тред получает прогресс исходного вместе с прогоном", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "flow",
      sdk: {
        threads: {
          send: async () => ({ delivery: "started" }),
          get: async () => ({ projectId: "proj_1", environmentId: "env_1" }),
          spawn: async () => ({ id: "thr_new" }),
        },
        environments: { get: async () => ({ hostId: "host_1", path: "/tree", branchName: "bb/thr_src" }) },
      },
    });
    const store = createStore(bb.storage.kv);
    const progress = createProgress(bb.storage.kv);
    const now = () => "2026-09-16T10:00:00.000Z";
    registerAskTool(bb, store, { newId: () => "H1", now, stages: () => settings, progress });
    registerApi(bb, store, { now, progress });
    registerProgress(bb, progress, { now, stages: () => settings, windowCost: async () => undefined });
    await harness.callAgentTool(ASK_TOOL_NAME, { title: "Бриф", setup: { stages: [{ id: "select", state: "todo" }, { id: "task", state: "todo", recommended: true }] } }, { threadId: "thr_src" });
    await harness.callRpc("answerBrief", { id: "dec_H1", messageId: "m", answer: { briefId: "dec_H1", answers: [], place: "thread", stages: [{ id: "task", run: true, executor: "self" }] } });
    expect(await harness.callRpc("getFlowProgress", { threadId: "thr_new" })).toMatchObject({ done: 1, current: "task" });
  });
});
