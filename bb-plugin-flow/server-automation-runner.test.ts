// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import plugin from "./server";

afterEach(() => vi.unstubAllGlobals());

describe("исполнитель автоматизаций во входе сервера", () => {
  it("инструмента run_automation нет, а повтор и идущие треды отвечают, не ходя в сеть", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(String(url));
      return new Response("{}", { status: 404 });
    });
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    await plugin(bb);
    expect(harness.registrations.agentTools.map((t) => t.name)).not.toContain("run_automation");
    expect(await harness.callRpc("runningThreads", {})).toEqual([]);
    expect(await harness.callRpc("retryAutomation", { threadId: "thr_1", stage: "clarify" })).toEqual({ started: false });
    expect(urls).toEqual([]);
  });
});
