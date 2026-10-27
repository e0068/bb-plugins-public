// @vitest-environment node
// Предложенный агентом к снятию этап держит работу до утверждения; утверждение называет его и тем самым просит согласия.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { FlowProgress } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const WORK = [
  { id: "spec", kind: "skill" as const, skill: "spec", name: "Спецификация", executors: [] },
  { id: "implement", kind: "skill" as const, skill: "code-standards-fp", name: "Implementation", executors: [] },
];
const WITH_APPROVAL = { minButtonWidth: 170, stages: [...WORK, builtinStage("approve", [])] };
const WITH_DEMO = { minButtonWidth: 170, stages: [...WORK, builtinStage("demo", [])] };

const results = [{ label: "a.md", target: "docs/a.md" }];
const record: FlowProgress = { stages: { spec: { skipped: true, proposed: true }, implement: { skipped: false, finishedAt: "2026-10-13T11:00:00.000Z" } }, waiting: [] };

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

const send = async (stages: typeof WITH_APPROVAL, outcome: Record<string, unknown>) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  await store.markLaunched("thr_1");
  registerAskTool(bb, store, {
    newId: () => "E1",
    now: () => "2026-10-13T12:00:00.000Z",
    stages: () => stages,
    progress: { get: async () => record, recordBrief: async () => undefined },
  });
  return textOf(await harness.callAgentTool(ASK_TOOL_NAME, { title: "Итог", outcome }, { threadId: "thr_1" }));
};

const approval = (done: string[]) => send(WITH_APPROVAL, { stage: "approve", final: false, next: "Execution", done, pending: [], results });

describe("утверждение и предложенное к снятию", () => {
  it("утверждение, не называющее предложенный к снятию этап, не принимается", async () => {
    const reply = await approval(["Прогон утверждён"]);
    expect(reply).toMatch(/not accepted/);
    expect(reply).toMatch(/spec/);
  });

  it("утверждение, называющее этап и причину, принимается: предложенный этап утверждение не держит", async () => {
    expect(await approval(["Не выполняем: Спецификация — нет нового узла"])).not.toMatch(/not accepted/);
  });

  it("Демонстрация, пока предложенный этап не утверждён снятым, не принимается", async () => {
    const reply = await send(WITH_DEMO, { stage: "demo", final: true, done: ["Правка"], pending: [], results, documentsOnly: true });
    expect(reply).toMatch(/not accepted/);
    expect(reply).toMatch(/spec/);
  });
});
