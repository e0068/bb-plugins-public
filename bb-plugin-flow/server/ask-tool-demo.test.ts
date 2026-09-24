// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { STAGES } from "../core/stages-fixtures";
import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const THREAD = "thr_demo";
const settings: StageSettings = { stages: [...STAGES, builtinStage("demo", STAGES.map((s) => s.id))], minButtonWidth: 190 };

const outcome = { stage: "demo", final: true, done: ["План написан"], pending: [], results: [{ label: "plan.md", target: "docs/plans/plan.md" }], documentsOnly: true };

describe("Демонстрация в запущенном треде", () => {
  it("итог Демонстрации принимается, помечен запуском и хранит снимок этапов flow", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    const store = createStore(bb.storage.kv);
    await store.markLaunched(THREAD);
    registerAskTool(bb, store, { newId: () => "D1", now: () => "2026-09-16T10:00:00.000Z", stages: () => settings });
    await harness.callAgentTool(ASK_TOOL_NAME, { title: "Демонстрация", outcome }, { threadId: THREAD });
    const brief = await store.getBrief("dec_D1");
    expect(brief?.launched).toBe(true);
    expect(brief?.outcome?.stage).toBe("demo");
    expect(brief?.stages?.list).toEqual(settings.stages);
  });
});
