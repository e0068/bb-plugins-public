// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const STAGES = { minButtonWidth: 170, stages: [{ id: "review", skill: "code-review", name: "Review", review: false, executors: [] }] };
const outcome = (stage = "review") => ({ title: "Ревью", outcome: { stage, final: true, done: ["Ревью пройдено"], pending: [], results: [{ label: "review.md", target: "docs/review.md" }] } });
const isError = (result: unknown): boolean => typeof result === "object" && result !== null && (result as { isError?: boolean }).isError === true;

async function setup(launched: boolean) {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  if (launched) await store.markLaunched("thr_1");
  const emitted: unknown[][] = [];
  let counter = 0;
  registerAskTool(bb, store, { newId: () => `T${++counter}`, now: () => "2026-09-16T12:00:00.000Z", stages: () => STAGES, emit: (...args) => void emitted.push(args) });
  return { harness, emitted };
}

describe("событие «этап завершён» для Automations", () => {
  it("отклонённый бриф и бриф без итога не сообщают ничего", async () => {
    const refused = await setup(false);
    expect(isError(await refused.harness.callAgentTool(ASK_TOOL_NAME, outcome(), { threadId: "thr_1" }))).toBe(true);
    expect(refused.emitted).toEqual([]);
    const plain = await setup(true);
    await plain.harness.callAgentTool(
      ASK_TOOL_NAME,
      { title: "Вопрос", questions: [{ id: "q", question: "Да?", kind: "confirm", options: [{ id: "yes", action: "Yes" }] }] },
      { threadId: "thr_1" },
    );
    expect(plain.emitted).toEqual([]);
  });
});
