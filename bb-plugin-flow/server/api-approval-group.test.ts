// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { CHECKLIST_TOOL } from "../core/checklist";
import { builtinStage } from "../lib/stage-constants";
import type { DecisionBrief } from "../shared/contract";
import { registerApi } from "./api";
import { registerChecklistTool } from "./checklist-tool";
import { createStore } from "./store";

const T = "2026-10-13T10:00:00.000Z";
const THREAD = "thr_1";

const stages = { list: [builtinStage("questions", []), builtinStage("demo", []), builtinStage("approve", [])], minButtonWidth: 160 };
const questions: DecisionBrief = {
  id: "Q",
  threadId: THREAD,
  title: "Вопросы",
  createdAt: T,
  kind: "brief",
  settle: "approval",
  questions: [{ id: "go", kind: "fork", question: "Как делаем?", allowOwn: false, options: [{ id: "a", action: "Просто", description: "Одним файлом.", recommended: true }, { id: "b", action: "Сложно", description: "Тремя слоями.", recommended: false }] }],
};
const outcome = (stage: "demo" | "approve") => ({ stage, final: false, next: "Дальше", done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] });
const demo: DecisionBrief = { id: "D", threadId: THREAD, title: "Демонстрация", createdAt: T, kind: "brief", questions: [], stages, settle: "approval", outcome: outcome("demo") };
const approval: DecisionBrief = { id: "A", threadId: THREAD, title: "Утверждение", createdAt: T, kind: "brief", questions: [], stages, outcome: outcome("approve") };

const proceed = { briefId: "A", answers: [], outcome: { accepted: true } };
const picked = (optionId: string, note?: string) => ({ briefId: "Q", answers: [{ questionId: "go", optionIds: [optionId] }], ...(note === undefined ? {} : { note }) });

const host = async () => {
  const sent: string[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "flow",
    sdk: { threads: { send: async (args) => (sent.push(args.input.map((part) => ("text" in part ? part.text : "")).join("\n")), { delivery: "started" }) } },
  });
  const store = createStore(bb.storage.kv);
  for (const brief of [questions, demo, approval]) await store.putBrief(brief);
  await store.putThreadGroup(THREAD, { ids: ["Q", "D", "A"], lastApprove: true, folded: false });
  await store.putApprovalGroup("A", ["Q", "D", "A"]);
  registerApi(bb, store, { now: () => T });
  registerChecklistTool(bb, store);
  const call = (method: string, input: unknown) => harness.callRpc(method as never, input as never) as Promise<Record<string, unknown>>;
  const tool = (done: string[]) => harness.callAgentTool(CHECKLIST_TOOL, { done }, { threadId: THREAD });
  return { store, call, sent, tool };
};

describe("Утверждение отвечает за виджеты своей группы", () => {
  it("виджеты, копящие ответ, — его группа: отвеченные и без метки в неё не входят", async () => {
    const { call } = await host();
    expect(((await call("approvalMembers", { id: "A" })).members as DecisionBrief[]).map((b) => b.id)).toEqual(["Q", "D"]);
  });

  it("«Продолжить» без правок: ответ Вопросов ложится из черновика, агенту — одна реплика, чек-листа нет", async () => {
    const { call, store, sent } = await host();
    expect(await call("answerBrief", { id: "A", answer: proceed, messageId: "m", group: [{ id: "Q", answer: picked("a") }, { id: "D" }] })).toMatchObject({ kind: "accepted" });
    expect((await store.getAnswer("Q"))?.answer).toEqual(picked("a"));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Как делаем?");
    expect(await store.getChecklist(THREAD)).toBeNull();
    // Ответы на Вопросы — строками для строки этапа в баннере.
    expect(await store.getThreadAnswers(THREAD)).toEqual(["Как делаем? — Просто"]);
  });

  it("«Продолжить с правками»: комментарии к виджетам — чек-лист под ответом Утверждения и агенту в реплике", async () => {
    const { call, store, sent } = await host();
    await call("answerBrief", { id: "A", answer: proceed, messageId: "m", group: [{ id: "Q", answer: picked("b", "без лишних файлов") }, { id: "D", note: "проверь тёмную тему" }] });
    const items = [
      { id: "c1", where: "Вопросы", text: "без лишних файлов", done: false },
      { id: "c2", where: "Демонстрация", text: "проверь тёмную тему", done: false },
    ];
    expect(await store.getChecklist(THREAD)).toEqual({ approvalId: "A", items });
    expect((await call("getBrief", { id: "A" })).checklist).toEqual(items);
    expect(sent[0]).toContain("Комментарий к «Демонстрация»: проверь тёмную тему");
    expect(sent[0]).toContain(`c1 [ ] Вопросы: без лишних файлов`);
    expect(sent[0]).toContain(CHECKLIST_TOOL);
    // Комментарий виджета — пункт чек-листа, а не строка «ко всем вопросам».
    expect((await store.getAnswer("Q"))?.answer.note).toBe("без лишних файлов");
  });

  it("виджет группы, которого клиент не прислал, — отказ: ни Утверждение, ни ответы группы не записываются", async () => {
    const { call, store, sent } = await host();
    await expect(call("answerBrief", { id: "A", answer: proceed, messageId: "m", group: [{ id: "D" }] })).rejects.toThrow(/Q/);
    expect(await store.getAnswer("A")).toBeNull();
    expect(await store.getAnswer("Q")).toBeNull();
    expect(sent).toEqual([]);
  });

  it("Демонстрация группы помечается ушедшей с Утверждением: поле комментария ей больше не нужно, в следующую группу она не входит", async () => {
    const { call } = await host();
    await call("answerBrief", { id: "A", answer: proceed, messageId: "m", group: [{ id: "Q", answer: picked("a") }, { id: "D", note: "тема" }] });
    expect((await call("getBrief", { id: "D" })).sentWith).toBe("A");
    expect(((await call("approvalMembers", { id: "A" })).members as DecisionBrief[]).map((b) => b.id)).toEqual([]);
  });

  it("агент отмечает пункты инструментом; незнакомый id — отказ без отметки", async () => {
    const { call, store, tool } = await host();
    await call("answerBrief", { id: "A", answer: proceed, messageId: "m", group: [{ id: "Q", answer: picked("a", "одно") }, { id: "D", note: "другое" }] });
    expect(await tool(["c9"])).toMatchObject({ isError: true });
    expect(await tool(["c1"])).toContain("Still open: c2");
    expect(await tool(["c2"])).toContain("Every checklist item is done");
    expect((await store.getChecklist(THREAD))?.items.every((item) => item.done)).toBe(true);
  });
});

describe("финальное Утверждение после Демонстрации", () => {
  const finalOutcome = { stage: "approve", final: true, done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] };
  const settledDemo: DecisionBrief = { id: "D", threadId: THREAD, title: "Демонстрация", createdAt: T, kind: "brief", questions: [], stages, settle: "approval", outcome: outcome("demo") };
  const finalApproval: DecisionBrief = { id: "A", threadId: THREAD, title: "Утверждение", createdAt: T, kind: "brief", questions: [], stages, outcome: finalOutcome };
  // Демонстрация закрыта, Утверждение — последний этап: у агента работы впереди нет.
  const nothingAhead = { stages: { demo: { startedAt: T, finishedAt: T }, approve: { startedAt: T } }, waiting: [] };

  const open = async () => {
    const sent: string[] = [];
    const { bb, harness } = createFakePluginHost({
      pluginId: "flow",
      sdk: { threads: { send: async (args) => (sent.push(args.input.map((part) => ("text" in part ? part.text : "")).join("\n")), { delivery: "started" }) } },
    });
    const store = createStore(bb.storage.kv);
    for (const brief of [settledDemo, finalApproval]) await store.putBrief(brief);
    await store.putApprovalGroup("A", ["D", "A"]);
    registerApi(bb, store, { now: () => T, progress: { get: async () => nothingAhead, recordAnswer: async () => undefined, handOver: async () => undefined } as never });
    const answer = (group: unknown) => harness.callRpc("answerBrief" as never, { id: "A", answer: { briefId: "A", answers: [], outcome: { accepted: true } }, messageId: "m", group } as never);
    return { sent, answer };
  };

  it("без комментария к Демонстрации и без работы агента впереди агент не будится", async () => {
    const { sent, answer } = await open();
    expect(await answer([{ id: "D" }])).toMatchObject({ kind: "accepted" });
    expect(sent).toEqual([]);
  });

  it("с комментарием к Демонстрации агент получает его, даже когда работы впереди нет", async () => {
    const { sent, answer } = await open();
    await answer([{ id: "D", note: "проверь тёмную тему" }]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("проверь тёмную тему");
  });
});

describe("решение агента без Утверждения впереди", () => {
  it("рекомендации ложатся, как ответ кнопкой: пункты, ответы для баннера, события; прогон не трогается", async () => {
    const { bb } = createFakePluginHost({ pluginId: "flow" });
    const store = createStore(bb.storage.kv);
    const emitted: string[] = [];
    const brief: DecisionBrief = { ...questions, id: "QA", settle: "agent", setup: { criteria: ["Тесты зелёные"] } };
    const { recordDecided } = registerApi(bb, store, { now: () => T, emit: (trigger) => void emitted.push(trigger) });
    await recordDecided(brief);
    expect(await store.getThreadCriteria(THREAD)).toEqual(["Тесты зелёные"]);
    expect(await store.getThreadAnswers(THREAD)).toEqual(["Как делаем? — Просто"]);
    expect(emitted).toEqual(["flow.brief-answered", "flow.criteria-approved"]);
    expect(await store.getAnswer("QA")).toBeNull();
  });

  it("ответ на Утверждение снимает ожидание треда", async () => {
    const { call, store } = await host();
    await store.putAwaiting(THREAD, { briefId: "A", kind: "approve" });
    await call("answerBrief", { id: "A", answer: proceed, messageId: "m", group: [{ id: "Q", answer: picked("a") }, { id: "D" }] });
    expect(await store.listAwaiting()).toEqual([]);
  });
});
