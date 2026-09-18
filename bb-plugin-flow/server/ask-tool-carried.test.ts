// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { SETUP_ROW } from "../core/rows";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const host = () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "decisions" });
  let n = 0;
  const store = createStore(bb.storage.kv);
  registerAskTool(bb, store, { newId: () => `C${++n}`, now: () => "2026-09-14T00:00:00.000Z" });
  const idOf = (result: unknown) => /id="(dec_[^"]+)"/.exec(String(result))?.[1] ?? "";
  return { harness, store, idOf };
};

describe("перенос в новом брифе", () => {
  it("уточнение переноса не получает", async () => {
    const { harness, store, idOf } = host();
    const first = await store.getBrief(idOf(await harness.callAgentTool(ASK_TOOL_NAME, { title: "Первый", setup: { criteria: ["Тесты зелёные"] } })));
    await store.putThreadCarry(first!.threadId, { [SETUP_ROW.executor]: ["subagents"] });
    const result = await harness.callAgentTool(ASK_TOOL_NAME, {
      title: "Влить?",
      kind: "clarify",
      questions: [{ id: "m", question: "Влить?", kind: "yesno", options: [{ id: "yes", action: "Да" }, { id: "no", action: "Нет" }] }],
    });
    expect((await store.getBrief(idOf(result)))?.carried).toBeUndefined();
  });
});
