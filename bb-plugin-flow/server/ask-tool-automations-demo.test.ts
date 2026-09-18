// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const STAGES = { minButtonWidth: 170, stages: [{ id: "review", kind: "skill" as const, skill: "code-review", name: "Review", executors: [] }, builtinStage("demo", ["review"])] };

describe("событие «этап завершён» для Automations на Демонстрации", () => {
  it("сохранённая Демонстрация сообщает flow.stage-done один раз, с этапом Демонстрации", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    const store = createStore(bb.storage.kv);
    await store.markLaunched("thr_1");
    const emitted: unknown[][] = [];
    registerAskTool(bb, store, { newId: () => "E1", now: () => "2026-09-16T12:00:00.000Z", stages: () => STAGES, emit: (...args) => void emitted.push(args) });
    const outcome = { stage: "demo", final: true, done: ["Ревью пройдено"], pending: [], results: [{ label: "review.md", target: "memory/review.md" }], documentsOnly: true };
    await harness.callAgentTool(ASK_TOOL_NAME, { title: "Демонстрация", outcome }, { threadId: "thr_1" });
    expect(emitted).toEqual([["flow.stage-done", "thr_1", { stageId: "demo" }]]);
  });
});
