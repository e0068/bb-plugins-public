// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import plugin from "./server";
import { priced } from "./server/priced-fixture";

afterEach(() => vi.unstubAllGlobals());

describe("Flow и Automations во входе сервера", () => {
  it("без Automations бриф с этапами flow по умолчанию принимается: событие итога этапа его не ломает", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("connection refused");
    });
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    await plugin(bb);
    const result = await harness.callAgentTool(
      "ask_decision",
      priced({ title: "Вопрос", setup: { stages: [{ id: "questions", state: "todo" }, { id: "criteria", state: "todo" }, { id: "select", state: "todo" }, { id: "demo", state: "todo" }] }, questions: [{ id: "q", question: "Да?", kind: "confirm", options: [{ id: "yes", action: "Yes" }] }] }),
      { threadId: "thr_1" },
    );
    expect((result as { isError?: boolean }).isError ?? false).toBe(false);
  });
});
