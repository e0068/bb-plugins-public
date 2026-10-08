// @vitest-environment node
// Отметка этапа отвечает агенту, когда настройки Claude Code дерева треда уже сверены с новым прогрессом: агент зовёт
// навык этапа сразу после ответа, и файл к этому времени уже открывает его.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import type { StageSettings } from "../shared/contract";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";

const THREAD = "thr_settles";

describe("flow_stage дожидается сверки настроек", () => {
  it("ответ приходит после того, как сверка по отметке закончилась", async () => {
    const settings: StageSettings = { stages: [stage("spec"), stage("review")], minButtonWidth: 170 };
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    const events: string[] = [];
    const progress = createProgress(bb.storage.kv, {});
    registerProgress(bb, progress, {
      now: () => "2026-10-08T10:00:00.000Z",
      stages: () => settings,
      windowCost: async () => undefined,
      settled: async (threadId) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        events.push(`settled ${threadId} ${Object.keys((await progress.get(threadId))?.stages ?? {}).join(",")}`);
      },
    });
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "spec", state: "started" }, { threadId: THREAD });
    events.push("answered");
    expect(events).toEqual([`settled ${THREAD} spec`, "answered"]);
  });

  it("упавшая сверка отметку не роняет", async () => {
    const settings: StageSettings = { stages: [stage("spec")], minButtonWidth: 170 };
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    const progress = createProgress(bb.storage.kv, {});
    registerProgress(bb, progress, { now: () => "2026-10-08T10:00:00.000Z", stages: () => settings, windowCost: async () => undefined, settled: async () => Promise.reject(new Error("disk")) });
    expect(String(await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "spec", state: "started" }, { threadId: THREAD }))).toContain("marked started");
  });
});
