// @vitest-environment node
// Каждый ход, который начинается, — и владельца, и агента, и свой Flow — сперва сверяет настройки Claude Code дерева треда.
import { createFakePluginHost, makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { registerOwnerTurn } from "./owner-turn";

const THREAD = "thr_scope";

const host = (turnStart: (threadId: string) => Promise<void>) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  registerOwnerTurn(bb, { ownSend: () => true, ownerTurn: async () => undefined, turnStart });
  return (attempt: "start-turn" | "join-turn") =>
    harness.registrations.hooks["message.dispatch"]!({ ...makeMessageDispatchHookContext({ thread: { id: THREAD }, attempt }), initiator: "agent" } as never);
};

describe("начало хода сверяет настройки дерева треда", () => {
  it("начинающийся ход сверяет, вклинившийся — нет", async () => {
    const synced: string[] = [];
    const decide = host(async (threadId) => void synced.push(threadId));
    await decide("start-turn");
    await decide("join-turn");
    expect(synced).toEqual([THREAD]);
  });

  it("сбой сверки не запирает тред", async () => {
    const decide = host(() => Promise.reject(new Error("disk full")));
    expect(await decide("start-turn")).toEqual({ action: "proceed" });
  });
});
