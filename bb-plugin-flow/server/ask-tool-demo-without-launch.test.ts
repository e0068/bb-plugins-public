// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { CODE_FLOW, stage } from "../core/stages-fixtures";
import type { WorkStage } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const THREAD = "thr_answer";

/** Flow Answer владельца: два этапа-навыка, Демонстрация и архив — без брифа запуска. */
const ANSWER_FLOW: WorkStage[] = [
  stage("corpus", { name: "Corpus" }),
  stage("project", { name: "Project" }),
  { id: "demo", kind: "demo", skill: "", name: "Demonstration", executors: [] },
];

const host = (stages: WorkStage[]) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  registerAskTool(bb, store, { newId: () => "A1", now: () => "2026-10-04T10:00:00.000Z", stages: () => ({ stages, minButtonWidth: 170 }) });
  return (input: unknown) => harness.callAgentTool(ASK_TOOL_NAME, input, { threadId: THREAD });
};

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

const demo = { title: "Ответ", outcome: { stage: "demo", final: true, done: ["Ответ на вопрос"], pending: [], results: [{ label: "Статья", target: "https://example.com/acp" }] } };

describe("Демонстрация в треде, чей flow не начинается брифом", () => {
  it("flow без Вопросов, Критериев и Выбора этапов принимает Демонстрацию первым брифом", async () => {
    expect(textOf(await host(ANSWER_FLOW)(demo))).toContain("::decision");
  });

  it.each(["questions", "criteria", "select"] as const)("flow с этапом %s до запуска Демонстрацию отбивает", async (kind) => {
    const opening = CODE_FLOW.find((s) => s.kind === kind);
    if (opening === undefined) throw new Error(kind);
    expect(textOf(await host([opening, ...ANSWER_FLOW])(demo))).toContain("not started yet");
  });

  it("тред без flow Демонстрацию отбивает: Демонстрации у него нет", async () => {
    expect(textOf(await host([])(demo))).toContain("the flow has none");
  });
});
