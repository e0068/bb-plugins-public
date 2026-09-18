// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { registerAskTool } from "./ask-tool";
import { readPlanning, type PlanningSource } from "./planning";
import { createStore } from "./store";

const line = JSON.stringify({ type: "assistant", requestId: "r1", message: { id: "m1", model: "claude-opus-5", usage: { input_tokens: 1_000_000, output_tokens: 0 } } });

const source = (thread: unknown, identity: unknown[] = [{ type: "thread/identity", data: { providerThreadId: "sess-1" } }]): PlanningSource => ({
  threads: { get: async () => thread as never, events: { list: async () => identity as never } },
});

describe("чтение планирования из треда", () => {
  it("минуты от создания треда, доллары по логу сессии провайдера", async () => {
    const read = async (sessionId: string) => (sessionId === "sess-1" ? [line] : undefined);
    expect(await readPlanning(source({ createdAt: 0 }), "thr_1", 42 * 60_000, read)).toEqual({ minutes: 42, cost: 5 });
  });

  it("ответ threads.get с обёрткой thread читается так же", async () => {
    expect(await readPlanning(source({ thread: { createdAt: 0 } }), "thr_1", 60_000, async () => [line])).toEqual({ minutes: 1, cost: 5 });
  });

  it("без сессии провайдера или её лога — только минуты", async () => {
    expect(await readPlanning(source({ createdAt: 0 }, []), "thr_1", 60_000, async () => [line])).toEqual({ minutes: 1 });
    expect(await readPlanning(source({ createdAt: 0 }), "thr_1", 60_000, async () => undefined)).toEqual({ minutes: 1 });
  });

  it("сбой SDK не мешает брифу: планирования просто нет", async () => {
    const broken: PlanningSource = { threads: { get: async () => { throw new Error("down"); }, events: { list: async () => [] } } };
    expect(await readPlanning(broken, "thr_1", 60_000, async () => [line])).toBeUndefined();
  });

  it("инструмент записывает планирование в бриф", async () => {
    const host = createFakePluginHost();
    const store = createStore(host.bb.storage.kv);
    registerAskTool(host.bb, store, { newId: () => "p1", now: () => "2026-09-13T00:00:00.000Z", planning: async () => ({ minutes: 42, cost: 4.2 }) });
    await host.harness.callAgentTool("ask_decision", { title: "Бриф", setup: { criteria: ["Тесты зелёные"] } }, { threadId: "thr_1" });
    expect((await store.getBrief("dec_p1"))?.planning).toEqual({ minutes: 42, cost: 4.2 });
  });
});
