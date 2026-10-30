// @vitest-environment node
// Ответ на вопрос демо ложится записью виджета, но демонстрация остаётся отчётом: строку этапа «Вопросы» в баннере она не затирает.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { createStore } from "./store";

const T = "2026-10-29T10:00:00.000Z";
const THREAD = "thr_1";

const stages = { list: [builtinStage("questions", []), builtinStage("demo", []), builtinStage("approve", [])], minButtonWidth: 160 };
const fork = { id: "go", kind: "fork" as const, question: "Как делаем?", allowOwn: false, options: [{ id: "a", action: "Просто", description: "Одним файлом.", recommended: true }, { id: "b", action: "Сложно", description: "Тремя слоями.", recommended: false }] };
const bevel = { id: "bevel", kind: "fork" as const, question: "Чинить фаску?", allowOwn: false, options: [{ id: "fix", action: "Чинить", description: "Да.", recommended: true }, { id: "keep", action: "Оставить", description: "Нет.", recommended: false }] };
const outcome = (stage: "demo" | "approve") => ({ stage, final: false, next: "Дальше", done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] });
const questions: DecisionBrief = { id: "Q", threadId: THREAD, title: "Вопросы", createdAt: T, kind: "brief", settle: "approval", questions: [fork] };
const demo: DecisionBrief = { id: "D", threadId: THREAD, title: "Демонстрация", createdAt: T, kind: "brief", questions: [bevel], stages, settle: "approval", outcome: outcome("demo") };
const approval: DecisionBrief = { id: "A", threadId: THREAD, title: "Утверждение", createdAt: T, kind: "brief", questions: [], stages, outcome: outcome("approve") };

const host = async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  for (const brief of [questions, demo, approval]) await store.putBrief(brief);
  await store.putThreadGroup(THREAD, { ids: ["Q", "D", "A"], lastApprove: true, folded: false });
  await store.putApprovalGroup("A", ["Q", "D", "A"]);
  registerApi(bb, store, { now: () => T });
  const call = (method: string, input: unknown) => harness.callRpc(method as never, input as never) as Promise<Record<string, unknown>>;
  return { store, call };
};

const proceed = { briefId: "A", answers: [], outcome: { accepted: true } };
const group = [
  { id: "Q", answer: { briefId: "Q", answers: [{ questionId: "go", optionIds: ["a"] }] } },
  { id: "D", answer: { briefId: "D", answers: [{ questionId: "bevel", optionIds: ["keep"] }] } },
];

describe("ответ демонстрации с вопросами в записи группы", () => {
  it("записывается, а ответы этапа «Вопросы» в баннере остаются ответами Вопросов", async () => {
    const { call, store } = await host();
    await call("answerBrief", { id: "A", answer: proceed, messageId: "m", group });
    expect((await store.getAnswer("D"))?.answer).toEqual(group[1]!.answer);
    expect(await store.getThreadAnswers(THREAD)).toEqual(["Как делаем? — Просто"]);
  });

  it("с Утверждением вопросы без демо в группе по-прежнему пишут свои ответы в баннер", async () => {
    const { call, store } = await host();
    await call("answerBrief", { id: "A", answer: proceed, messageId: "m", group });
    expect(await store.getThreadAnswers(THREAD)).toContain("Как делаем? — Просто");
    expect(await store.getThreadAnswers(THREAD)).not.toContain("Чинить фаску? — Оставить");
  });
});
