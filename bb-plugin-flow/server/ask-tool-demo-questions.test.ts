// @vitest-environment node
// Вопрос по демо задаётся в самой демонстрации: инструмент берёт его, когда впереди Утверждение, и копит ответ до него.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const THREAD = "thr_demo_questions";
const withApproval: StageSettings = { stages: [builtinStage("demo", []), builtinStage("approve", ["demo"])], minButtonWidth: 190 };
const withoutApproval: StageSettings = { stages: [builtinStage("demo", [])], minButtonWidth: 190 };

const outcome = { stage: "demo", final: false, next: "Дальше", done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }], documentsOnly: true };
const question = { id: "go", kind: "confirm", question: "Чинить фаску?", options: [{ id: "yes", action: "Yes" }] };

const host = async (settings: StageSettings) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  await store.markLaunched(THREAD);
  registerAskTool(bb, store, { newId: () => "R1", now: () => "2026-10-29T10:00:00.000Z", stages: () => settings, flowIds: () => [] });
  const ask = async (input: unknown) => JSON.stringify(await harness.callAgentTool(ASK_TOOL_NAME, input, { threadId: THREAD }));
  return { ask, store };
};

describe("вопрос в демонстрации", () => {
  it("с Утверждением впереди демо с вопросом принимается и копит ответ до него", async () => {
    const { ask, store } = await host(withApproval);
    const result = await ask({ title: "Демо", outcome, questions: [question] });
    expect(result).not.toContain("Brief not accepted");
    expect(result).toContain("answers and comment on it arrive with the next approval");
    const stored = await store.getBrief("dec_R1");
    expect(stored?.questions.map((q) => q.id)).toEqual(["go"]);
    expect(stored?.settle).toBe("approval");
  });

  it("без Утверждения впереди ответу некуда уйти: вопрос отбивается и идёт уточнением", async () => {
    const { ask, store } = await host(withoutApproval);
    const result = await ask({ title: "Демо", outcome, questions: [question] });
    expect(result).toContain("a demo is a report: questions go as a clarify");
    expect(await store.getBrief("dec_R1")).toBeNull();
  });

  it("демо без вопросов принимается и там, и там", async () => {
    for (const settings of [withApproval, withoutApproval]) {
      const { ask } = await host(settings);
      expect(await ask({ title: "Демо", outcome, questions: [] })).not.toContain("Brief not accepted");
    }
  });
});
