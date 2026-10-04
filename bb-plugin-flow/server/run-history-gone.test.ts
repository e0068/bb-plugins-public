// @vitest-environment node
// «Тред удалён» в истории прогонов — только на ответ bb «тред не найден»: случайный сбой чтения живой тред удалённым не делает.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { registerApi } from "./api";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { FLOW_STAGE_TOOL, createProgress, registerProgress, type ThreadState } from "./progress";
import { createStore } from "./store";
import { priced } from "./priced-fixture";

const settings: StageSettings = { stages: [builtinStage("questions", []), stage("task", { name: "Задача" })], minButtonWidth: 170 };

type Entry = { briefId: string; threadId: string; title: string | null; exists: boolean };
type Read = (threadId: string) => Promise<ThreadState>;

/** Ошибка, какую бросает SDK bb на ответ сервера не 2xx. */
const httpError = (status: number, message: string) => Object.assign(new Error(`HTTP ${status}: ${message}`), { name: "BbHttpError", status });

const live = (title: string): ThreadState => ({ environmentId: null, active: false, providerId: null, title });

/** Сборка как в server.ts; чтение треда подменяется по ходу теста. */
const host = async () => {
  let clock = Date.parse("2026-10-04T10:00:00.000Z");
  const now = () => new Date(clock).toISOString();
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  let freeze: (threadId: string) => Promise<void> = async () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => void freeze(threadId) });
  let briefs = 0;
  registerAskTool(bb, store, { newId: () => `run${++briefs}`, now, stages: () => settings, progress });
  registerApi(bb, store, { now, progress });
  let read: Read = async (threadId) => live(`Тред ${threadId}`);
  freeze = registerProgress(bb, progress, { now, stages: () => settings, flowName: () => "Разработка", windowCost: async () => 1, thread: (threadId) => read(threadId) }).freezeFinished;
  const runThrough = async (threadId: string, briefId: string) => {
    await harness.callAgentTool(ASK_TOOL_NAME, priced({ title: "Бриф", setup: { stages: [{ id: "questions", state: "todo" }, { id: "task", state: "todo", recommended: true }] } }), { threadId });
    await harness.callRpc("answerBrief", { id: briefId, messageId: "m", answer: { briefId, answers: [], stages: [{ id: "task", run: true, executor: "self" }] } });
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "started" }, { threadId });
    clock += 60_000;
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: "task", state: "done" }, { threadId });
    await new Promise((resolve) => setTimeout(resolve, 20));
  };
  const history = async () => (await harness.callRpc("getRunHistory", {})) as Entry[];
  return { runThrough, history, reads: (next: Read) => void (read = next) };
};

describe("подпись удалённого треда в истории прогонов", () => {
  it("bb ответил «тред не найден» — строка помечена удалённой", async () => {
    const h = await host();
    await h.runThrough("thr_a", "dec_run1");
    h.reads(async () => {
      throw httpError(404, "Thread not found");
    });
    expect(await h.history()).toMatchObject([{ threadId: "thr_a", title: null, exists: false }]);
  });

  it("чтение упало не 404 — тред живой, с названием, сохранённым при заморозке прогона", async () => {
    const h = await host();
    await h.runThrough("thr_a", "dec_run1");
    h.reads(async () => {
      throw httpError(503, "Service Unavailable");
    });
    expect(await h.history()).toMatchObject([{ threadId: "thr_a", title: "Тред thr_a", exists: true }]);
  });

  it("сбой без статуса HTTP тоже не делает тред удалённым", async () => {
    const h = await host();
    await h.runThrough("thr_a", "dec_run1");
    h.reads(async () => {
      throw new Error("fetch failed");
    });
    expect(await h.history()).toMatchObject([{ threadId: "thr_a", exists: true }]);
  });

  it("первое чтение упало, повтор прочитал — в строке живое название", async () => {
    const h = await host();
    await h.runThrough("thr_a", "dec_run1");
    let calls = 0;
    h.reads(async (threadId) => {
      if (++calls === 1) throw httpError(503, "Service Unavailable");
      return live(`Новое имя ${threadId}`);
    });
    expect(await h.history()).toMatchObject([{ threadId: "thr_a", title: "Новое имя thr_a", exists: true }]);
  });
});

describe("повтор чтения", () => {
  it("сбой читается повторно ровно один раз, «не найден» — ни разу", async () => {
    const h = await host();
    await h.runThrough("thr_a", "dec_run1");
    const count = async (status: number) => {
      let calls = 0;
      h.reads(async () => {
        calls++;
        throw httpError(status, "x");
      });
      await h.history();
      return calls;
    };
    expect([await count(503), await count(404)]).toEqual([2, 1]);
  });
});

describe("чтение тредов истории", () => {
  it("треды читаются порциями, а не все разом", async () => {
    const h = await host();
    for (let i = 0; i < 20; i++) await h.runThrough(`thr_${i}`, `dec_run${i + 1}`);
    let inFlight = 0;
    let peak = 0;
    h.reads(async (threadId) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return live(threadId);
    });
    expect(await h.history()).toHaveLength(20);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
  });
});
