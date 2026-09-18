// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import plugin from "./server";

afterEach(() => vi.unstubAllGlobals());

describe("Flow и Automations во входе сервера", () => {
  it("без Automations брифы работают как раньше: событие итога этапа не ломает бриф", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("connection refused");
    });
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    await plugin(bb);
    const result = await harness.callAgentTool(
      "ask_decision",
      { title: "Вопрос", questions: [{ id: "q", question: "Да?", kind: "confirm", options: [{ id: "yes", action: "Yes" }] }] },
      { threadId: "thr_1" },
    );
    expect((result as { isError?: boolean }).isError ?? false).toBe(false);
  });
});
