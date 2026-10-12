// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { FlowProgress, StageSettings } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const THREAD = "thr_guard";
const settings: StageSettings = { stages: [builtinStage("demo", []), builtinStage("approve", ["demo"])], minButtonWidth: 190 };

const outcome = (stage: string) => ({ stage, final: false, next: "Дальше", done: ["Сделано"], pending: [], results: [{ label: "task.md", target: "docs/tasks/task.md" }], documentsOnly: true as const });

const send = async (progress: FlowProgress | null) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  await store.markLaunched(THREAD);
  registerAskTool(bb, store, { newId: () => "G1", now: () => "2026-10-12T10:00:00.000Z", stages: () => settings, progress: { get: async () => progress, recordBrief: async () => undefined } });
  const result = await harness.callAgentTool(ASK_TOOL_NAME, { title: "Утверждение", outcome: outcome("approve") }, { threadId: THREAD });
  return { text: JSON.stringify(result), brief: await store.getBrief("dec_G1") };
};

describe("утверждение без присланной демонстрации", () => {
  it("не открывается: агент получает отказ с указанием, что прислать сначала", async () => {
    const { text, brief } = await send({ stages: {}, waiting: [] });
    expect(brief).toBeNull();
    expect(text).toContain("Brief not accepted");
    expect(text).toContain("Demonstration");
    expect(text).toContain("has no widget yet — send it first");
  });

  it("с присланной демонстрацией выше проходит", async () => {
    const { brief } = await send({ stages: { demo: { finishedAt: "2026-10-12T09:00:00.000Z" } }, waiting: [] });
    expect(brief?.outcome?.stage).toBe("approve");
  });
});
