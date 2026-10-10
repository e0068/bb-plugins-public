// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { STAGES } from "../core/stages-fixtures";
import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const THREAD = "thr_approve";
const taken = STAGES.map((s) => s.id);
const settings: StageSettings = { stages: [...STAGES, builtinStage("approve", taken), builtinStage("demo", [...taken, "approve"])], minButtonWidth: 190 };

/** Итог без живой ссылки и без пометки «только документы». */
const plain = (stage: string) => ({ stage, final: false, next: "Execution", done: ["Definition of Done — восемь пунктов"], pending: [], results: [{ label: "task.md", target: "docs/tasks/task.md" }] });

const send = async (stage: string) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  await store.markLaunched(THREAD);
  registerAskTool(bb, store, { newId: () => "A1", now: () => "2026-10-10T10:00:00.000Z", stages: () => settings });
  const result = await harness.callAgentTool(ASK_TOOL_NAME, { title: "Утверждение", outcome: plain(stage) }, { threadId: THREAD });
  return { result: JSON.stringify(result), brief: await store.getBrief("dec_A1"), awaiting: await store.listAwaiting() };
};

describe("Утверждение в запущенном треде", () => {
  it("итог этапа «Утверждение» принимается без живой ссылки и ждёт утверждения", async () => {
    const { brief, awaiting } = await send("approve");
    expect(brief?.outcome?.stage).toBe("approve");
    expect(awaiting).toEqual([{ threadId: THREAD, briefId: "dec_A1", kind: "approve" }]);
  });

  it("Демонстрации живая ссылка по-прежнему нужна", async () => {
    const { result, brief } = await send("demo");
    expect(brief).toBeNull();
    expect(result).toContain("outcome.results has no live result");
  });

  it("итог этапа-навыка не принимается: докладывают только Демонстрация и Утверждение", async () => {
    const { result } = await send(STAGES[0]!.id);
    expect(result).toContain("is not a demo or approval stage");
  });
});
