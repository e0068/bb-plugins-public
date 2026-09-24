// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { ASK_INSTRUCTIONS, ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const THREAD = "thr_kinds";

const settings: StageSettings = {
  stages: [builtinStage("questions", []), builtinStage("select", []), stage("task", { name: "Задача" }), builtinStage("demo", []), builtinStage("criteria", []), builtinStage("select", ["select"]), stage("code", { name: "Код" })],
  minButtonWidth: 170,
};

const host = async (launched: boolean) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  if (launched) await store.markLaunched(THREAD);
  registerAskTool(bb, store, { newId: () => "K1", now: () => "2026-09-16T10:00:00.000Z", stages: () => settings });
  const ask = (input: unknown) => harness.callAgentTool(ASK_TOOL_NAME, input, { threadId: THREAD });
  return { ask, store, harness };
};

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

const link = { label: "task.md", target: "docs/tasks/task.md" };
const secondSelect = [
  { id: "questions", state: "done" },
  { id: "select", state: "done" },
  { id: "task", state: "done", results: [link] },
  { id: "demo", state: "done" },
  { id: "criteria", state: "todo" },
  { id: "select-2", state: "todo" },
  { id: "code", state: "todo", recommended: true },
];

describe("ask_decision и виды этапов", () => {
  it("после запуска второй Выбор этапов и Критерии принимаются, пока они не сделаны", async () => {
    const { ask, store } = await host(true);
    const result = textOf(await ask({ title: "Дальше", setup: { stages: secondSelect, criteria: ["Код зелёный"] } }));
    expect(result).toContain("::decision");
    const brief = await store.getBrief("dec_K1");
    expect(brief?.launched).toBeUndefined();
  });

  it("после запуска этапы без несделанного Выбора этапов не принимаются", async () => {
    const { ask } = await host(true);
    const done = secondSelect.map((s) => (s.id === "select-2" || s.id === "criteria" ? { ...s, state: "done" } : s));
    expect(textOf(await ask({ title: "Дальше", setup: { stages: done } }))).toContain("already launched");
  });

  it("этап в состоянии review новый бриф не принимает", async () => {
    const { ask } = await host(false);
    const stages = secondSelect.map((s) => (s.id === "task" ? { ...s, state: "review" } : s));
    await expect(ask({ title: "Бриф", setup: { stages } })).rejects.toThrow(/state review is gone/);
  });

  it("итог — только у этапа вида Демонстрация", async () => {
    const { ask } = await host(true);
    const outcome = { final: false, next: "Код", done: ["Задача заведена"], pending: [], results: [link], documentsOnly: true };
    expect(textOf(await ask({ title: "Итог", outcome: { ...outcome, stage: "task" } }))).toMatch(/demo/i);
    expect(textOf(await ask({ title: "Итог", outcome: { ...outcome, stage: "demo" } }))).toContain("::decision");
  });

  it("инструкции инструмента и вклад в ход не упоминают Review by User и несут правило flow", async () => {
    const { harness } = await host(false);
    expect(ASK_INSTRUCTIONS).not.toMatch(/Review by User/);
    const contributed = harness.registrations.instructionProvider?.({ threadId: THREAD, projectId: "p" }) ?? "";
    expect(contributed).not.toMatch(/Review by User/);
    expect(contributed).toMatch(/only through/);
  });
});
