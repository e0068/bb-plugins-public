// @vitest-environment node
// Сообщение ждёт выбора flow, только когда оно начинает ход: вклинившееся в идущий ход, повтор упавшего, своя отправка Flow
// и Side chat уходят сразу, а выбора не спрашивают.
import { createFakePluginHost, makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { CHOOSING_REASON, registerOwnerTurn } from "./owner-turn";

const THREAD = "thr_auto";

const host = (options: { own?: boolean } = {}) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const asked: string[] = [];
  registerOwnerTurn(bb, { ownSend: () => options.own ?? false, ownerTurn: async () => undefined, autoChoice: { gate: (_, text) => (asked.push(text), "wait") } });
  const decide = (initiator: string, overrides: Parameters<typeof makeMessageDispatchHookContext>[0] = {}) =>
    harness.registrations.hooks["message.dispatch"]!({ ...makeMessageDispatchHookContext({ thread: { id: THREAD }, input: { blocks: [], text: "Почини" }, ...overrides }), initiator } as never);
  return { asked, decide };
};

describe("ожидание выбора flow в хуке отправки", () => {
  it.each(["user", "agent"])("сообщение, которое начинает ход (%s), ждёт с подписью «Выбираю flow»", async (initiator) => {
    const { asked, decide } = host();
    expect(await decide(initiator, { attempt: "start-turn" })).toEqual({ action: "wait", reason: CHOOSING_REASON });
    expect(asked).toEqual(["Почини"]);
  });

  it.each([
    ["вклинившееся в идущий ход", {}, { attempt: "join-turn" as const }],
    ["повтор упавшего хода", {}, { attempt: "start-turn" as const, queuedMessage: { payload: { kind: "retry" } } as never }],
    ["своя отправка Flow", { own: true }, { attempt: "start-turn" as const }],
    ["Side chat", {}, { attempt: "start-turn" as const, thread: { id: THREAD, originPluginId: "side-chat" } }],
  ])("%s — уходит сразу, выбора не спрашивает", async (_, options, overrides) => {
    const { asked, decide } = host(options);
    expect(await decide("user", overrides)).toEqual({ action: "proceed" });
    expect(asked).toEqual([]);
  });
});
