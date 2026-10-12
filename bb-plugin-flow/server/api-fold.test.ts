// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const T = "2026-10-12T10:00:00.000Z";
const THREAD = "thr_1";

const questions: DecisionBrief = { id: "Q", threadId: THREAD, title: "Вопросы", createdAt: T, kind: "brief", questions: [{ id: "go", kind: "confirm", question: "Так?", allowOwn: false, options: [{ id: "yes", action: "Yes", recommended: true }] }] };
const result = { label: "a.md", target: "a.md" };
const stages = { list: [builtinStage("demo", []), builtinStage("approve", [])], minButtonWidth: 160 };
const outcomeBrief = (id: string, stage: "demo" | "approve"): DecisionBrief => ({ id, threadId: THREAD, title: id, createdAt: T, kind: "brief", questions: [], stages, outcome: { stage, final: false, next: "Дальше", done: ["Сделано"], pending: [], results: [result] } });
const approval = outcomeBrief("A", "approve");
const demo = outcomeBrief("D", "demo");

const answered = { briefId: "Q", answers: [{ questionId: "go", optionIds: ["yes"] }] };
const comment = (id: string) => ({ briefId: id, answers: [], outcome: { accepted: false, note: "поправь этап" } });
const proceed = (id: string) => ({ briefId: id, answers: [], outcome: { accepted: true } });

const host = async (group?: string[]) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  for (const brief of [questions, demo, approval]) await store.putBrief(brief);
  if (group !== undefined) {
    await store.putThreadGroup(THREAD, { ids: group, lastApprove: true, folded: false });
    await store.putApprovalGroup("A", group);
  }
  registerApi(bb, store, { now: () => T });
  const call = (method: string, input: unknown) => harness.callRpc(method as never, input as never) as Promise<Record<string, unknown>>;
  const signals = () => harness.realtimeSignals.map((s) => (s.payload as { id: string }).id);
  return { store, call, signals };
};

describe("комментарий к утверждению сворачивает группу", () => {
  it("виджеты от прошлого утверждения до этого: каждый знает держателя и группу, строка встаёт на утверждении", async () => {
    const { call } = await host(["Q", "D", "A"]);
    await call("answerBrief", { id: "Q", answer: answered, messageId: "m1" });
    await call("answerBrief", { id: "A", answer: comment("A"), messageId: "m2" });
    for (const id of ["Q", "D", "A"]) expect((await call("getBrief", { id })).fold).toEqual({ holder: "A", ids: ["Q", "D", "A"] });
  });

  it("свёрнутый отвеченный виджет остаётся отвеченным: ответ хранится, чтобы раскрытая строка его показала", async () => {
    const { call } = await host(["Q", "A"]);
    await call("answerBrief", { id: "Q", answer: answered, messageId: "m1" });
    await call("answerBrief", { id: "A", answer: comment("A"), messageId: "m2" });
    expect(((await call("getBrief", { id: "Q" })).answer as { answer: unknown }).answer).toEqual(answered);
    expect(((await call("getBrief", { id: "A" })).answer as { answer: unknown }).answer).toEqual(comment("A"));
  });

  it("каждый виджет группы перечитывается: событие по id каждого, ответ утверждения — последним", async () => {
    const { call, signals } = await host(["Q", "D", "A"]);
    await call("answerBrief", { id: "A", answer: comment("A"), messageId: "m" });
    expect(signals()).toEqual(["Q", "D", "A"]);
  });

  it("указатель возврата встаёт на утверждение: новые виджеты до следующего утверждения возьмут выбор группы", async () => {
    const { store, call } = await host(["Q", "A"]);
    await store.putThreadReturned(THREAD, "Q");
    await call("answerBrief", { id: "A", answer: comment("A"), messageId: "m" });
    expect(await store.getThreadReturned(THREAD)).toBe("A");
  });

  it("тред без списка группы: сворачивается одно утверждение", async () => {
    const { call } = await host();
    await call("answerBrief", { id: "A", answer: comment("A"), messageId: "m" });
    expect((await call("getBrief", { id: "A" })).fold).toEqual({ holder: "A", ids: ["A"] });
    expect((await call("getBrief", { id: "Q" })).fold).toBeUndefined();
  });

  it("список треда помнит свёрнутое утверждение — нужно, чтобы отбить следующее без доработок", async () => {
    const { store, call } = await host(["Q", "A"]);
    await call("answerBrief", { id: "A", answer: comment("A"), messageId: "m" });
    expect(await store.getThreadGroup(THREAD)).toEqual({ ids: ["Q", "A"], lastApprove: true, folded: true });
  });
});

describe("не комментарий — ничего не сворачивается", () => {
  it("«Продолжить» без комментария", async () => {
    const { store, call, signals } = await host(["Q", "A"]);
    await call("answerBrief", { id: "Q", answer: answered, messageId: "m1" });
    await call("answerBrief", { id: "A", answer: proceed("A"), messageId: "m2" });
    expect((await call("getBrief", { id: "Q" })).fold).toBeUndefined();
    expect((await call("getBrief", { id: "A" })).fold).toBeUndefined();
    expect(await store.getThreadGroup(THREAD)).toEqual({ ids: ["Q", "A"], lastApprove: true, folded: false });
    expect(signals()).toEqual(["Q", "A"]);
  });

  it("ответ на Демонстрацию отбивается, ответ на вопросы — свёртки нет", async () => {
    const { call } = await host(["Q", "D", "A"]);
    await expect(call("answerBrief", { id: "D", answer: comment("D"), messageId: "m1" })).rejects.toThrow(/a demo is a report/);
    await call("answerBrief", { id: "Q", answer: answered, messageId: "m2" });
    for (const id of ["Q", "D", "A"]) expect((await call("getBrief", { id })).fold).toBeUndefined();
  });
});

describe("getBrief свёрнутого виджета", () => {
  it("неотвеченный член группы отдаёт черновик владельца; отвеченный и без черновика — нет", async () => {
    const { store, call } = await host(["Q", "D", "A"]);
    await store.putDraft("Q", "{черновик}");
    await call("answerBrief", { id: "A", answer: comment("A"), messageId: "m" });
    expect((await call("getBrief", { id: "Q" })).draft).toBe("{черновик}");
    expect((await call("getBrief", { id: "D" })).draft).toBeUndefined();
    expect((await call("getBrief", { id: "A" })).draft).toBeUndefined();
  });

  it("несвёрнутый неотвеченный виджет черновика не отдаёт: его держит окно", async () => {
    const { store, call } = await host(["Q", "A"]);
    await store.putDraft("Q", "{черновик}");
    expect(await call("getBrief", { id: "Q" })).toMatchObject({ kind: "found", answer: null });
    expect((await call("getBrief", { id: "Q" })).draft).toBeUndefined();
  });

  it("виджет, возвращённый до групп (метка есть, свёртки нет), — группа из одного", async () => {
    const { store, call } = await host();
    await store.markReturned("Q");
    expect((await call("getBrief", { id: "Q" })).fold).toEqual({ holder: "Q", ids: ["Q"] });
  });

  it("ответ кнопкой — последнее слово владельца: «Продолжить» снимает указатель возврата утверждения", async () => {
    const { store, call } = await host(["Q", "A"]);
    await store.putThreadReturned(THREAD, "A");
    await call("answerBrief", { id: "A", answer: proceed("A"), messageId: "m" });
    expect(await store.getThreadReturned(THREAD)).toBeNull();
  });
});
