// @vitest-environment node
import { createFakePluginHost, makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { registerOwnerTurn } from "./owner-turn";

const THREAD = "thr_side";

const host = () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const calls: string[] = [];
  const log = (name: string) => async () => void calls.push(name);
  registerOwnerTurn(bb, { ownSend: () => false, ownerTurn: log("ownerTurn"), firstMessage: log("firstMessage"), ownerMessage: log("ownerMessage"), turnStart: log("turnStart"), sideChat: log("sideChat") });
  const send = (originPluginId: string | null) =>
    harness.registrations.hooks["message.dispatch"]!({ ...makeMessageDispatchHookContext({ thread: { id: THREAD, status: "pending", originPluginId }, attempt: "start-turn" }), initiator: "user" } as never);
  return { calls, send };
};

describe("Side chat Flow не ведёт", () => {
  it("вопрос в Side chat не даёт треду flow, прогон и выбор и не сверяет навыки дерева — только снимает доставшийся flow", async () => {
    const { calls, send } = host();
    expect(await send("side-chat")).toEqual({ action: "proceed" });
    expect(calls).toEqual(["sideChat"]);
  });

  it("первое сообщение обычного треда идёт прежним путём", async () => {
    const { calls, send } = host();
    await send(null);
    expect(calls).toEqual(["firstMessage", "ownerTurn", "ownerMessage", "turnStart"]);
  });
});
