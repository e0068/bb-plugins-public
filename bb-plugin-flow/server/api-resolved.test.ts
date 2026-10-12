// @vitest-environment node
// getBrief отдаёт признак «решено»: неотвеченное уточнение, которое агент закрыл через resolves, виджет рисует строкой.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const T = "2026-10-12T10:00:00.000Z";
const clarify: DecisionBrief = { id: "C", threadId: "thr_1", title: "Уточнение", createdAt: T, kind: "clarify", questions: [{ id: "ok", kind: "yesno", question: "Так?", allowOwn: false, options: [{ id: "yes", action: "Yes", recommended: false }, { id: "no", action: "No", recommended: false }] }] };

const host = async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  await store.putBrief(clarify);
  registerApi(bb, store, { now: () => T });
  const getBrief = () => harness.callRpc("getBrief" as never, { id: "C" } as never) as Promise<Record<string, unknown>>;
  return { store, getBrief };
};

describe("getBrief и решённое уточнение", () => {
  it("обычное уточнение приходит без признака", async () => {
    const { getBrief } = await host();
    expect(await getBrief()).not.toHaveProperty("resolved");
  });

  it("закрытое агентом неотвеченное уточнение приходит с resolved: true", async () => {
    const { store, getBrief } = await host();
    await store.markResolved("C");
    expect((await getBrief()).resolved).toBe(true);
  });

  it("ответ владельца, пришедший раньше, остаётся ответом: признака нет", async () => {
    const { store, getBrief } = await host();
    await store.putAnswer("C", { answer: { briefId: "C", answers: [{ questionId: "ok", optionIds: ["yes"] }] }, messageId: "m", answeredAt: T });
    await store.markResolved("C");
    const found = await getBrief();
    expect(found).not.toHaveProperty("resolved");
    expect(found.answer).not.toBeNull();
  });
});
