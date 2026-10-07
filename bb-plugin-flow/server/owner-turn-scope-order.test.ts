// @vitest-environment node
// Сверка настроек в начале хода идёт после того, как ход применил выбранный flow: первый ход нового flow стартует с его настройками.
import { createFakePluginHost, makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { registerOwnerTurn } from "./owner-turn";

describe("порядок в начале хода", () => {
  it("выбранный flow применяется до сверки настроек", async () => {
    const order: string[] = [];
    const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
    registerOwnerTurn(bb, {
      ownSend: () => false,
      ownerTurn: async () => void order.push("flow"),
      turnStart: async () => void order.push("scope"),
    });
    await harness.registrations.hooks["message.dispatch"]!({ ...makeMessageDispatchHookContext({ thread: { id: "thr" }, attempt: "start-turn" }), initiator: "user" } as never);
    expect(order).toEqual(["flow", "scope"]);
  });
});
