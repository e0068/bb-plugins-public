// @vitest-environment node
import { createFakePluginHost, makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { registerOwnerTurn } from "./owner-turn";

const THREAD = "thr_turn";

const host = (options: { ownerTurn?: (threadId: string) => Promise<void>; own?: boolean } = {}) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const turns: string[] = [];
  registerOwnerTurn(bb, { ownSend: () => options.own ?? false, ownerTurn: options.ownerTurn ?? (async (threadId) => void turns.push(threadId)) });
  const decide = (initiator: string, overrides: Parameters<typeof makeMessageDispatchHookContext>[0] = {}) =>
    harness.registrations.hooks["message.dispatch"]!({ ...makeMessageDispatchHookContext({ thread: { id: THREAD }, ...overrides }), initiator } as never);
  return { turns, decide };
};

describe("ход владельца применяет flow, выбранный в контейнере состояния Flow", () => {
  it("владелец начинает ход — выбор применяется, и сообщение уходит без придержания", async () => {
    const { turns, decide } = host();
    expect(await decide("user", { attempt: "start-turn" })).toEqual({ action: "proceed" });
    expect(turns).toEqual([THREAD]);
  });

  it("сообщение, вклинившееся в идущий ход, сообщение агента и своя отправка Flow выбор не применяют", async () => {
    const joined = host();
    await joined.decide("user", { attempt: "join-turn" });
    const agent = host();
    await agent.decide("agent", { attempt: "start-turn" });
    const own = host({ own: true });
    await own.decide("user", { attempt: "start-turn" });
    expect([...joined.turns, ...agent.turns, ...own.turns]).toEqual([]);
  });

  it("сбой применения не запирает тред: сообщение уходит", async () => {
    const { decide } = host({ ownerTurn: () => Promise.reject(new Error("kv down")) });
    expect(await decide("user", { attempt: "start-turn" })).toEqual({ action: "proceed" });
  });
});
