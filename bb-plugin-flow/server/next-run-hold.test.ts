// @vitest-environment node
import { createFakePluginHost, makeMessageDispatchHookContext, makeQueueEntry } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createFlowSettings } from "./flow-settings";
import { registerNextRun } from "./next-run";
import { createThreadFlows } from "./thread-flows";

const THREAD = "thr_next";
const REASON = "Каким flow идти дальше?";

type Options = { finished?: boolean | (() => Promise<boolean>); queued?: unknown[]; compact?: () => unknown; own?: (threadId: string, text: string) => boolean };

const HELD = [makeQueueEntry({ threadId: THREAD, waitingOn: { kind: "plugin", pluginId: "flow", reason: REASON } })];

const host = async (options: Options = {}) => {
  const calls: string[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: {
      threads: {
        compact: async () => {
          calls.push(`compact@${harness.recheckCount}`);
          return options.compact?.() ?? { compacted: true };
        },
        queuedMessages: { list: async () => options.queued ?? HELD },
      },
    },
  });
  const flows = await createFlowSettings(bb.storage.kv);
  const threads = await createThreadFlows(bb.storage.kv);
  const removed: string[] = [];
  const finished = options.finished ?? true;
  registerNextRun(bb, {
    flows,
    threads,
    progress: { remove: async (threadId) => void removed.push(threadId) },
    finished: typeof finished === "function" ? finished : async () => finished,
    heldReason: () => REASON,
    ownSend: options.own ?? (() => false),
  });
  const decide = (overrides: Parameters<typeof makeMessageDispatchHookContext>[0] = {}) =>
    harness.registrations.hooks["message.dispatch"]!(makeMessageDispatchHookContext({ thread: { id: THREAD }, ...overrides, ...({ initiator: "user" } as object) }));
  return { harness, calls, flows, threads, removed, decide };
};

describe("хук: сообщение владельца в тред с завершённым прогоном ждёт выбора flow", () => {
  it("прогон завершён — сообщение придержано с вопросом о flow", async () => {
    const { decide } = await host();
    expect(await decide()).toEqual({ action: "wait", reason: REASON });
  });

  it("прогон не завершён — сообщение уходит как раньше", async () => {
    const { decide } = await host({ finished: false });
    expect(await decide()).toEqual({ action: "proceed" });
  });

  it("сообщение агента другого треда не придерживается", async () => {
    const { harness } = await host();
    const context = { ...makeMessageDispatchHookContext({ thread: { id: THREAD } }), initiator: "agent", senderThreadId: "thr_other" };
    expect(await harness.registrations.hooks["message.dispatch"]!(context)).toEqual({ action: "proceed" });
  });

  it("отправка самого Flow — ответ на бриф, побудка после автоматизаций — не придерживается", async () => {
    const { decide } = await host({ own: (threadId, text) => threadId === THREAD && text === "Демонстрация — продолжить" });
    expect(await decide({ input: { text: "Демонстрация — продолжить" } })).toEqual({ action: "proceed" });
  });

  it("сбой чтения прогона не запирает тред: сообщение уходит", async () => {
    const { decide } = await host({ finished: () => Promise.reject(new Error("kv down")) });
    expect(await decide()).toEqual({ action: "proceed" });
  });
});

describe("выбор flow отпускает придержанное сообщение", () => {
  it("flow достаётся треду, прошлый прогон снимается, и хук спрашивается заново", async () => {
    const { harness, flows, threads, removed } = await host();
    const flowId = flows.current().flows[0]!.id;
    expect(await harness.callRpc("startNextRun", { threadId: THREAD, flowId, compact: false })).toEqual({ kind: "sent" });
    expect(threads.flowOf(THREAD)).toBe(flowId);
    expect(removed).toEqual([THREAD]);
    expect(harness.recheckCount).toBe(1);
  });

  it("компактация идёт раньше, чем сообщение отпущено, — иначе она срезала бы его", async () => {
    const { harness, calls, flows } = await host();
    await harness.callRpc("startNextRun", { threadId: THREAD, flowId: flows.current().flows[0]!.id, compact: true });
    expect(calls).toEqual(["compact@0"]);
    expect(harness.recheckCount).toBe(1);
  });

  it("придержанного сообщения нет — второе нажатие или устаревшая форма ничего не трогают", async () => {
    const { harness, threads, removed, calls } = await host({ queued: [] });
    expect(await harness.callRpc("startNextRun", { threadId: THREAD, flowId: "none", compact: true })).toEqual({ kind: "failed", reason: "not-held" });
    expect(threads.flowOf(THREAD)).not.toBe("none");
    expect(removed).toEqual([]);
    expect(calls).toEqual([]);
    expect(harness.recheckCount).toBe(0);
  });

  it("«без flow» принимается", async () => {
    const { harness, threads } = await host();
    expect(await harness.callRpc("startNextRun", { threadId: THREAD, flowId: "none", compact: false })).toEqual({ kind: "sent" });
    expect(threads.flowOf(THREAD)).toBe("none");
  });

  it("неизвестный flow отбивается, сообщение остаётся придержанным", async () => {
    const { harness } = await host();
    expect(await harness.callRpc("startNextRun", { threadId: THREAD, flowId: "flow_ghost", compact: false })).toMatchObject({ kind: "failed", reason: "unknown-flow" });
    expect(harness.recheckCount).toBe(0);
  });

  it("сбой компактации возвращает причину, сообщение остаётся придержанным", async () => {
    const { harness } = await host({
      compact: () => {
        throw new Error("host down");
      },
    });
    expect(await harness.callRpc("startNextRun", { threadId: THREAD, flowId: "none", compact: true })).toMatchObject({ kind: "failed", reason: "host down" });
    expect(harness.recheckCount).toBe(0);
  });
});

describe("форма узнаёт, придержано ли сообщение треда", () => {
  it("строка очереди на ожидании Flow — придержано", async () => {
    const { harness } = await host({ queued: [makeQueueEntry({ threadId: THREAD, waitingOn: { kind: "plugin", pluginId: "flow", reason: REASON } })] });
    expect(await harness.callRpc("nextRunHeld", { threadId: THREAD })).toEqual({ held: true });
  });

  it("строки на чужом ожидании и пустая очередь — не придержано", async () => {
    const { harness } = await host({ queued: [makeQueueEntry({ threadId: THREAD, waitingOn: { kind: "thread-busy" } }), makeQueueEntry({ threadId: THREAD, waitingOn: { kind: "plugin", pluginId: "limiter", reason: "full" } })] });
    expect(await harness.callRpc("nextRunHeld", { threadId: THREAD })).toEqual({ held: false });
  });
});
