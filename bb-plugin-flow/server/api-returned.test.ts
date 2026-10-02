// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const T = "2026-10-02T10:00:00.000Z";

const brief: DecisionBrief = { id: "dec_r", threadId: "thr_1", title: "Бриф", createdAt: T, kind: "brief", questions: [{ id: "go", kind: "confirm", question: "Так?", allowOwn: false, options: [{ id: "yes", action: "Yes", recommended: true }] }] };

const host = async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  await store.putBrief(brief);
  registerApi(bb, store, { now: () => T });
  return { store, call: (method: string, input: unknown) => harness.callRpc(method as never, input as never) as Promise<Record<string, unknown>> };
};

describe("возвращённый бриф в API виджета", () => {
  it("черновик пишется, пока бриф ждёт; после возврата бриф отдаётся возвращённым, а черновик больше не принимается", async () => {
    const { store, call } = await host();
    expect(await call("saveBriefDraft", { id: brief.id, draft: "{}" })).toEqual({ kind: "saved" });
    expect(await store.getDraft(brief.id)).toBe("{}");
    expect((await call("getBrief", { id: brief.id })).returned).toBeUndefined();
    await store.markReturned(brief.id);
    expect((await call("getBrief", { id: brief.id })).returned).toBe(true);
    expect(await call("saveBriefDraft", { id: brief.id, draft: "{\"x\":1}" })).toEqual({ kind: "closed" });
    expect(await store.getDraft(brief.id)).toBe("{}");
  });

  it("отвеченный бриф рисуется ответом, даже если его возвращали; черновик неизвестного брифа — not_found", async () => {
    const { store, call } = await host();
    await store.markReturned(brief.id);
    await call("answerBrief", { id: brief.id, answer: { briefId: brief.id, answers: [{ questionId: "go", optionIds: ["yes"] }] }, messageId: "m" });
    expect((await call("getBrief", { id: brief.id })).returned).toBeUndefined();
    expect(await call("saveBriefDraft", { id: "dec_none", draft: "{}" })).toEqual({ kind: "not_found" });
  });

  it("ответ кнопкой снимает указатель возвращённого брифа и его черновик: следующий бриф не получит выбор отвеченного", async () => {
    const { store, call } = await host();
    await store.putDraft(brief.id, "{}");
    await store.putThreadReturned(brief.threadId, brief.id);
    await call("answerBrief", { id: brief.id, answer: { briefId: brief.id, answers: [{ questionId: "go", optionIds: ["yes"] }] }, messageId: "m" });
    expect(await store.getThreadReturned(brief.threadId)).toBeNull();
    expect(await store.getDraft(brief.id)).toBeNull();
  });
});
