// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { StageSettings, WorkStage } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const stage = (id: string, patch: Partial<WorkStage> = {}): WorkStage => ({ id, kind: "skill", skill: id, name: id, executors: [], ...patch });
// Ревью — заголовок: своего навыка и исполнения нет, работу несут под-этапы.
const settings: StageSettings = { stages: [stage("practice"), stage("review", { skill: "" }), stage("lint", { parent: "review" })], minButtonWidth: 190 };

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

describe("ask_decision и этап-заголовок", () => {
  it("заголовку доля не нужна: бриф без неё у заголовка принят", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    registerAskTool(bb, createStore(bb.storage.kv), { newId: () => "B1", now: () => "2026-10-03T10:00:00.000Z", stages: () => settings });
    const stages = [
      { id: "practice", state: "todo", recommended: true, share: { percent: 100, risk: 2 } },
      { id: "review", state: "todo", recommended: true },
      { id: "lint", state: "todo", recommended: true, share: { percent: 10, risk: -1 } },
    ];
    const brief = { title: "Бриф", scope: "- база", setup: { criteria: [{ text: "Пункт", add: { target: 2, max: 3, risk: 0, minutes: 15 } }], stages } };
    expect(textOf(await harness.callAgentTool(ASK_TOOL_NAME, brief, { threadId: "thr_heading" }))).toContain("::decision");
  });
});

describe("ask_decision и пройденный этап-заголовок", () => {
  it("заголовок, отмеченный сделанным без результатов, бриф не роняет", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    registerAskTool(bb, createStore(bb.storage.kv), { newId: () => "B2", now: () => "2026-10-03T10:00:00.000Z", stages: () => settings });
    const stages = [
      { id: "practice", state: "done", results: [{ label: "app.tsx", target: "app.tsx" }] },
      { id: "review", state: "done" },
      { id: "lint", state: "todo", recommended: true, share: { percent: 100, risk: -1 } },
    ];
    const brief = { title: "Бриф", scope: "- база", setup: { criteria: [{ text: "Пункт", add: { target: 2, max: 3, risk: 0, minutes: 15 } }], stages } };
    expect(textOf(await harness.callAgentTool(ASK_TOOL_NAME, brief, { threadId: "thr_heading_done" }))).toContain("::decision");
  });
});
