// @vitest-environment node
import { createFakePluginHost, makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";

import type { Steps } from "@bb-plugins/automation-steps/index";
import { STEP_IDS } from "@bb-plugins/automation-steps/catalog";
import { stage } from "../core/stages-fixtures";
import type { AwaitingKind, StageSettings, WorkStage } from "../shared/contract";
import { createAutomationRunner } from "./automation-runner";
import { returnAwaitingBrief } from "./brief-return";
import { registerOwnerTurn } from "./owner-turn";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_xqu7qai4i3";
const T0 = "2026-10-02T10:00:00.000Z";

const steps = Object.fromEntries(STEP_IDS.map((id) => [id, async () => ({ ok: true, detail: null })])) as unknown as Steps;
const commit: WorkStage = { id: "commit", kind: "skill", skill: "", name: "commit", executors: [], automation: { source: "flow", steps: ["git.create-pr"] } };
const demo: WorkStage = { id: "demo", kind: "demo", skill: "", name: "Demonstration", executors: [] };

/** Плагин на фейковом хосте: прогон с автоматизацией перед Демонстрацией, хук хода владельца и побудки агента. */
const setup = () => {
  const settings: StageSettings = { stages: [stage("review"), commit, demo], minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  const woken: string[] = [];
  const published: string[] = [];
  let advance: (threadId: string) => void = () => undefined;
  const progress = createProgress(bb.storage.kv, { onChange: (threadId) => advance(threadId) });
  const thread = async () => ({ active: false, providerId: "claude-code", environmentId: null });
  const runner = createAutomationRunner({
    progress,
    store,
    stages: () => settings,
    steps,
    external: async () => ({ ok: true, detail: null }),
    thread,
    providers: async () => [],
    wake: async (_threadId, text) => void woken.push(text),
    kv: bb.storage.kv,
    plugins: { list: async () => ({ plugins: [] }), applyUpdate: async () => undefined, install: async () => undefined, remove: async () => undefined },
    now: () => T0,
    onError: (error) => {
      throw error;
    },
  });
  advance = (threadId) => void runner.advance(threadId);
  registerProgress(bb, progress, { now: () => T0, stages: () => settings, windowCost: async () => undefined, thread, startTimeoutMs: 100 });
  registerOwnerTurn(bb, {
    ownSend: () => false,
    ownerTurn: async () => undefined,
    ownerMessage: (threadId) => returnAwaitingBrief({ store, publish: (id) => void published.push(id) }, threadId),
  });
  const write = (initiator: string, overrides: Parameters<typeof makeMessageDispatchHookContext>[0] = {}) =>
    harness.registrations.hooks["message.dispatch"]!({ ...makeMessageDispatchHookContext({ thread: { id: THREAD }, attempt: "start-turn", ...overrides }), initiator } as never);
  const markDone = async (id: string) => {
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: id, state: "started" }, { threadId: THREAD });
    await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: id, state: "done" }, { threadId: THREAD });
  };
  const awaiting = async () => (await store.listAwaiting()).filter((e) => e.threadId === THREAD);
  const waiting = (briefId: string, kind: AwaitingKind) => store.putAwaiting(THREAD, { briefId, kind });
  return { store, woken, published, write, markDone, awaiting, waiting };
};

describe("сообщение владельца в чат при ждущем брифе возвращает бриф агенту", () => {
  it("тред thr_xqu7qai4i3: Демонстрацию обсудили в чате, агент доделал правку, автоматизация доиграла — агента будят на Демонстрацию", async () => {
    const { woken, write, markDone, waiting } = setup();
    await waiting("dec_old_demo", "demo");
    await write("user");
    await markDone("review");
    await vi.waitFor(() => expect(woken).toHaveLength(1));
  });

  it("ожидание и значок сняты, бриф помечен возвращённым и отдан следующему брифу треда, виджет узнаёт об этом", async () => {
    const { store, published, write, awaiting, waiting } = setup();
    await waiting("dec_questions", "questions");
    await write("user", { attempt: "join-turn" });
    expect(await awaiting()).toEqual([]);
    expect(await store.isReturned("dec_questions")).toBe(true);
    expect(await store.getThreadReturned(THREAD)).toBe("dec_questions");
    expect(published).toEqual(["dec_questions"]);
  });

  it("кнопки автоматизации и этапа Action сообщением не снимаются: это не бриф", async () => {
    for (const kind of ["automation", "action"] as const) {
      const { store, write, awaiting, waiting } = setup();
      await waiting(`stage-${kind}`, kind);
      await write("user");
      expect(await awaiting()).toHaveLength(1);
      expect(await store.getThreadReturned(THREAD)).toBeNull();
    }
  });

  it("сообщение агента и повтор упавшего хода бриф не возвращают", async () => {
    const agent = setup();
    await agent.waiting("dec_a", "criteria");
    await agent.write("agent");
    expect(await agent.awaiting()).toHaveLength(1);
    const retry = setup();
    await retry.waiting("dec_r", "criteria");
    await retry.write("user", { queuedMessage: { payload: { kind: "retry" } } } as never);
    expect(await retry.awaiting()).toHaveLength(1);
  });
});

describe("свои отправки Flow бриф не возвращают", () => {
  it("ответ кнопкой брифа и побудка Flow идут от имени владельца, но ожидание остаётся", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    const store = createStore(bb.storage.kv);
    registerOwnerTurn(bb, { ownSend: () => true, ownerTurn: async () => undefined, ownerMessage: (threadId) => returnAwaitingBrief({ store, publish: () => undefined }, threadId) });
    await store.putAwaiting(THREAD, { briefId: "dec_wait", kind: "demo" });
    await harness.registrations.hooks["message.dispatch"]!({ ...makeMessageDispatchHookContext({ thread: { id: THREAD }, attempt: "start-turn" }), initiator: "user" } as never);
    expect(await store.listAwaiting()).toHaveLength(1);
  });
});
