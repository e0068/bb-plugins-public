// @vitest-environment node
// Первое сообщение треда, который уезжает из чекаута в своё дерево, ждёт в очереди, пока Flow заводит новый тред.
import { createFakePluginHost, makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { registerOwnerTurn } from "./owner-turn";
import { RELOCATING_REASON, type FirstDispatch, type RelocationDecision } from "./relocate";

const host = (hold: (dispatch: FirstDispatch) => Promise<RelocationDecision>) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const asked: FirstDispatch[] = [];
  registerOwnerTurn(bb, {
    ownSend: () => false,
    ownerTurn: async () => undefined,
    relocation: {
      hold: async (dispatch) => {
        asked.push(dispatch);
        return hold(dispatch);
      },
    },
  });
  const decide = (overrides: Record<string, unknown>) =>
    harness.registrations.hooks["message.dispatch"]!({ ...makeMessageDispatchHookContext({ thread: { id: "thr_s", projectId: "p", title: "Кнопка", status: "pending" } as never, attempt: "start-turn" }), initiator: "user", ...overrides } as never);
  return { asked, decide };
};

describe("перенос из чекаута в хуке первого сообщения", () => {
  it("тред уезжает — сообщение ждёт с подписью переноса; хук получил намерение окружения и сообщение", async () => {
    const { asked, decide } = host(async () => ({ action: "wait", reason: RELOCATING_REASON }));
    expect(await decide({ environmentIntent: { kind: "provider", environmentProviderId: "project-checkout" } })).toEqual({ action: "wait", reason: RELOCATING_REASON });
    expect(asked[0]).toMatchObject({ thread: { id: "thr_s", projectId: "p", title: "Кнопка" }, environmentIntent: { kind: "provider", environmentProviderId: "project-checkout" } });
  });

  it("после переноса хук отвечает решением переноса — отказом со ссылкой на новый тред", async () => {
    const { decide } = host(async () => ({ action: "reject", message: "Тред перенесён в @thread:thr_new" }));
    expect(await decide({})).toEqual({ action: "reject", message: "Тред перенесён в @thread:thr_new" });
  });

  it("тред остаётся — сообщение уходит", async () => {
    const { decide } = host(async () => null);
    expect(await decide({})).toEqual({ action: "proceed" });
  });

  it("сбой переноса не запирает тред — сообщение уходит", async () => {
    const { decide } = host(async () => Promise.reject(new Error("kv down")));
    expect(await decide({})).toEqual({ action: "proceed" });
  });

  it("идущий тред перенос не спрашивает", async () => {
    const { asked, decide } = host(async () => ({ action: "wait", reason: RELOCATING_REASON }));
    const active = makeMessageDispatchHookContext({ thread: { id: "thr_s", status: "idle" } as never, attempt: "start-turn" });
    expect(await decide({ thread: active.thread })).toEqual({ action: "proceed" });
    expect(asked).toEqual([]);
  });
});
