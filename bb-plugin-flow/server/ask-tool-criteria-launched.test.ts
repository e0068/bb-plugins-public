// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const THREAD = "thr_crit";
const settings: StageSettings = { stages: [builtinStage("select", []), stage("task"), builtinStage("demo", []), builtinStage("criteria", []), stage("code")], minButtonWidth: 170 };

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

describe("Критерии посреди flow без второго Выбора этапов", () => {
  it("после запуска этапы и критерий принимаются, пока Критерии не сделаны", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    const store = createStore(bb.storage.kv);
    await store.markLaunched(THREAD);
    registerAskTool(bb, store, { newId: () => "C1", now: () => "2026-09-16T10:00:00.000Z", stages: () => settings });
    const stages = [
      { id: "select", state: "done" },
      { id: "task", state: "done", results: [{ label: "t.md", target: "t.md" }] },
      { id: "demo", state: "done" },
      { id: "criteria", state: "todo" },
      { id: "code", state: "todo", recommended: true },
    ];
    expect(textOf(await harness.callAgentTool(ASK_TOOL_NAME, { title: "Критерии", setup: { stages, criteria: ["Код зелёный"] } }, { threadId: THREAD }))).toContain("::decision");
  });

  it("инструкции инструмента не упоминают ожидание приёмки", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    registerAskTool(bb, createStore(bb.storage.kv), { newId: () => "C2", now: () => "2026-09-16T10:00:00.000Z", stages: () => settings });
    const tool = harness.registrations.agentTools.find((t) => t.name === ASK_TOOL_NAME);
    expect(`${tool?.description} ${tool?.instructions}`).not.toMatch(/acceptance|awaiting review/);
  });
});
