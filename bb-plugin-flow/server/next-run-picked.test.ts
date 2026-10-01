// @vitest-environment node
import { createFakePluginHost, makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { createFlowSettings } from "./flow-settings";
import { registerNextRun } from "./next-run";
import { createThreadFlows } from "./thread-flows";

const THREAD = "thr_turn";

const host = async (options: { ownerTurn?: (threadId: string) => Promise<void>; own?: boolean } = {}) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { queuedMessages: { list: async () => [] } } } });
  const turns: string[] = [];
  registerNextRun(bb, {
    flows: await createFlowSettings(bb.storage.kv),
    threads: await createThreadFlows(bb.storage.kv),
    progress: { remove: async () => undefined },
    finished: async () => false,
    heldReason: () => "",
    ownSend: () => options.own ?? false,
    ownerTurn: options.ownerTurn ?? (async (threadId) => void turns.push(threadId)),
  });
  const decide = (initiator: string, overrides: Parameters<typeof makeMessageDispatchHookContext>[0] = {}) =>
    harness.registrations.hooks["message.dispatch"]!({ ...makeMessageDispatchHookContext({ thread: { id: THREAD }, ...overrides }), initiator } as never);
  return { turns, decide };
};

describe("сообщение владельца применяет flow, выбранный над композером", () => {
  it("владелец начинает ход — выбор применяется до того, как ход получит инструкции", async () => {
    const { turns, decide } = await host();
    expect(await decide("user", { attempt: "start-turn" })).toEqual({ action: "proceed" });
    expect(turns).toEqual([THREAD]);
  });

  it("сообщение, вклинившееся в идущий ход, выбор не применяет", async () => {
    const { turns, decide } = await host();
    await decide("user", { attempt: "join-turn" });
    expect(turns).toEqual([]);
  });

  it("сообщение агента другого треда и своя отправка Flow выбор не применяют", async () => {
    const agent = await host();
    await agent.decide("agent", { attempt: "start-turn" });
    expect(agent.turns).toEqual([]);
    const own = await host({ own: true });
    await own.decide("user", { attempt: "start-turn" });
    expect(own.turns).toEqual([]);
  });

  it("сбой применения не запирает тред: сообщение уходит", async () => {
    const { decide } = await host({ ownerTurn: () => Promise.reject(new Error("kv down")) });
    expect(await decide("user", { attempt: "start-turn" })).toEqual({ action: "proceed" });
  });
});
