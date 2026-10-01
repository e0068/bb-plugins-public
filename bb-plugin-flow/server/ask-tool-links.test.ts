// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

describe("ссылки в тексте брифа — описание ask_decision", () => {
  it("говорит агенту писать упоминания файлов markdown-ссылками во всех текстовых полях", () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "decisions" });
    registerAskTool(bb, createStore(bb.storage.kv), { newId: () => "T1", now: () => "2026-10-01T00:00:00.000Z" });
    const description = harness.registrations.agentTools.find((t) => t.name === ASK_TOOL_NAME)?.description ?? "";
    expect(description).toContain("Every text field takes markdown links [text](target)");
    expect(description).toContain('"fragment (what it is) — file"');
  });
});
