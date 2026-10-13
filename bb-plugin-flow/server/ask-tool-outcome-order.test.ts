// @vitest-environment node
// Демонстрация показывает пройденную работу: этап прогона перед ней, который агент не закрыл, держит её.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { FlowProgress } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const STAGES = {
  minButtonWidth: 170,
  stages: [
    { id: "implement", kind: "skill" as const, skill: "code-standards-fp", name: "Implementation", executors: [] },
    { id: "review", kind: "skill" as const, skill: "code-review", name: "Review", executors: [] },
    builtinStage("demo", []),
  ],
};

const outcome = { stage: "demo", final: true, done: ["Правка"], pending: [], results: [{ label: "a.md", target: "docs/a.md" }], documentsOnly: true };

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

const send = async (record: FlowProgress) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  await store.markLaunched("thr_1");
  registerAskTool(bb, store, {
    newId: () => "E1",
    now: () => "2026-10-13T12:00:00.000Z",
    stages: () => STAGES,
    progress: { get: async () => record, recordBrief: async () => undefined },
  });
  return textOf(await harness.callAgentTool(ASK_TOOL_NAME, { title: "Демонстрация", outcome }, { threadId: "thr_1" }));
};

describe("Демонстрация после незакрытого этапа прогона", () => {
  it("ревью в прогоне не закрыто — Демонстрация не принимается, отказ называет ревью", async () => {
    const reply = await send({ stages: { implement: { skipped: false, finishedAt: "2026-10-13T11:00:00.000Z" }, review: { skipped: false } }, waiting: [] });
    expect(reply).toMatch(/not accepted/);
    expect(reply).toMatch(/review/);
  });

  it("ревью снято владельцем с прогона — Демонстрация принимается", async () => {
    const reply = await send({ stages: { implement: { skipped: false, finishedAt: "2026-10-13T11:00:00.000Z" }, review: { skipped: true } }, waiting: [] });
    expect(reply).not.toMatch(/not accepted/);
  });
});
