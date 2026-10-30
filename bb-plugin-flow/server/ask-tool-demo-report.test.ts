// @vitest-environment node
// Демонстрация — отчёт: без вопросов и без рекомендованного flow. Перевод в другой flow агент предлагает утверждением.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const THREAD = "thr_report";
const settings: StageSettings = { stages: [builtinStage("demo", []), builtinStage("approve", ["demo"])], minButtonWidth: 190 };

const outcome = (stage: string, extra: Record<string, unknown> = {}) => ({ stage, final: false, next: "Дальше", done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }], documentsOnly: true, ...extra });
const question = { id: "go", kind: "confirm", question: "Так?", options: [{ id: "yes", action: "Yes" }] };

const host = async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  await store.markLaunched(THREAD);
  registerAskTool(bb, store, { newId: () => "R1", now: () => "2026-10-12T10:00:00.000Z", stages: () => settings, flowIds: () => ["flow-bug", "flow-code"] });
  const ask = async (input: unknown) => JSON.stringify(await harness.callAgentTool(ASK_TOOL_NAME, input, { threadId: THREAD }));
  return { ask, store };
};

describe("Демонстрация — отчёт без вопросов", () => {
  it("итог без вопросов принимается", async () => {
    const { ask, store } = await host();
    expect(await ask({ title: "Демо", outcome: outcome("demo"), questions: [] })).not.toContain("Brief not accepted");
    expect(await store.getBrief("dec_R1")).not.toBeNull();
  });

  it("у Утверждения вопросы по-прежнему допустимы", async () => {
    const { ask, store } = await host();
    expect(await ask({ title: "Утв", outcome: outcome("approve"), questions: [question] })).not.toContain("Brief not accepted");
    expect(await store.getBrief("dec_R1")).not.toBeNull();
  });
});

describe("nextFlow — только у Утверждения", () => {
  it("Демонстрация с nextFlow отбивается: работу переводит кнопка утверждения", async () => {
    const { ask, store } = await host();
    const result = await ask({ title: "Демо", outcome: outcome("demo", { nextFlow: "flow-bug" }), questions: [] });
    expect(result).toContain("outcome.nextFlow goes on an approval: the owner moves the work with its button");
    expect(await store.getBrief("dec_R1")).toBeNull();
  });

  it("Демонстрация с неизвестным flow получает один отказ — про место nextFlow, а не про список flow", async () => {
    const { ask } = await host();
    const result = await ask({ title: "Демо", outcome: outcome("demo", { nextFlow: "no-such" }), questions: [] });
    expect(result).toContain("outcome.nextFlow goes on an approval");
    expect(result).not.toContain("is not one of the owner's flows");
  });

  it("Утверждение с nextFlow из flow владельца принимается и хранит его", async () => {
    const { ask, store } = await host();
    expect(await ask({ title: "Утв", outcome: outcome("approve", { nextFlow: "flow-bug" }), questions: [] })).not.toContain("Brief not accepted");
    expect((await store.getBrief("dec_R1"))?.outcome?.nextFlow).toBe("flow-bug");
  });

  it("Утверждение с nextFlow вне flow владельца отбивается и называет их", async () => {
    const { ask, store } = await host();
    const result = await ask({ title: "Утв", outcome: outcome("approve", { nextFlow: "no-such" }), questions: [] });
    expect(result).toContain("outcome.nextFlow no-such is not one of the owner's flows: flow-bug, flow-code");
    expect(await store.getBrief("dec_R1")).toBeNull();
  });
});
