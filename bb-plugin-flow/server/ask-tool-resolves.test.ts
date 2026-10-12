// @vitest-environment node
// resolves: агент закрывает решённое уточнение следующим вызовом ask_decision; виджет рисуется строкой «Решено».
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const THREAD = "thr_resolves";
const T = "2026-10-12T10:00:00.000Z";
const settings: StageSettings = { stages: [builtinStage("demo", [])], minButtonWidth: 190 };

const clarify = (title: string) => ({ title, kind: "clarify", questions: [{ id: "ok", question: "Так?", kind: "yesno", options: [{ id: "yes", action: "Yes" }, { id: "no", action: "No" }] }] });
const brief = { title: "Вопрос", questions: [{ id: "go", kind: "confirm", question: "Так?", options: [{ id: "yes", action: "Yes" }] }] };
const demo = { title: "Демо", questions: [], outcome: { stage: "demo", final: true, done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }], documentsOnly: true } };

const host = async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  await store.markLaunched(THREAD);
  let n = 0;
  registerAskTool(bb, store, { newId: () => `K${++n}`, now: () => T, stages: () => settings });
  const ask = async (input: unknown, threadId = THREAD) => JSON.stringify(await harness.callAgentTool(ASK_TOOL_NAME, input, { threadId }));
  const signals = () => harness.realtimeSignals.map((s) => (s.payload as { id: string }).id);
  return { ask, store, signals };
};

describe("resolves закрывает решённое уточнение", () => {
  it("уточнение помечается решённым в хранилище, виджеты получают сигнал перерисоваться", async () => {
    const { ask, store, signals } = await host();
    await ask(clarify("Уточнение"));
    expect(await store.isResolved("dec_K1")).toBe(false);
    await ask({ ...brief, resolves: ["dec_K1"] });
    expect(await store.isResolved("dec_K1")).toBe(true);
    expect(signals()).toEqual(["dec_K1"]);
  });

  it("допустим в любом вызове: бриф, уточнение и итог Демонстрации", async () => {
    const { ask, store } = await host();
    await ask(clarify("Первое"));
    await ask(clarify("Второе"));
    await ask(clarify("Третье"));
    expect(await ask({ ...brief, resolves: ["dec_K1"] })).not.toContain("Brief not accepted");
    expect(await ask({ ...clarify("Четвёртое"), resolves: ["dec_K2"] })).not.toContain("Brief not accepted");
    expect(await ask({ ...demo, resolves: ["dec_K3"] })).not.toContain("Brief not accepted");
    for (const id of ["dec_K1", "dec_K2", "dec_K3"]) expect(await store.isResolved(id)).toBe(true);
  });

  it("список не попадает в хранимый бриф: он только команда", async () => {
    const { ask, store } = await host();
    await ask(clarify("Уточнение"));
    await ask({ ...brief, resolves: ["dec_K1"] });
    expect(await store.getBrief("dec_K2")).not.toHaveProperty("resolves");
  });

  it("повтор того же id и дубль в списке не ошибка", async () => {
    const { ask, store, signals } = await host();
    await ask(clarify("Уточнение"));
    expect(await ask({ ...brief, resolves: ["dec_K1", "dec_K1"] })).not.toContain("Brief not accepted");
    expect(await ask({ ...brief, resolves: ["dec_K1"] })).not.toContain("Brief not accepted");
    expect(await store.isResolved("dec_K1")).toBe(true);
    expect(signals().filter((id) => id === "dec_K1")).toHaveLength(2);
  });
});

describe("resolves отбивается с причиной, и ничего не пишется", () => {
  it("неизвестный id", async () => {
    const { ask, store } = await host();
    const result = await ask({ ...brief, resolves: ["dec_none"] });
    expect(result).toContain("Brief not accepted");
    expect(result).toContain("resolves dec_none is not a clarify of this thread");
    expect(await store.getBrief("dec_K1")).toBeNull();
  });

  it("уточнение чужого треда", async () => {
    const { ask, store } = await host();
    await ask(clarify("Чужое"), "thr_other");
    expect(await ask({ ...brief, resolves: ["dec_K1"] })).toContain("resolves dec_K1 is not a clarify of this thread");
    expect(await store.isResolved("dec_K1")).toBe(false);
  });

  it("бриф, а не уточнение", async () => {
    const { ask } = await host();
    await ask(brief);
    expect(await ask({ ...clarify("Другое"), resolves: ["dec_K1"] })).toContain("resolves dec_K1 is not a clarify");
  });

  it("уже отвеченное владельцем уточнение", async () => {
    const { ask, store } = await host();
    await ask(clarify("Уточнение"));
    await store.putAnswer("dec_K1", { answer: { briefId: "dec_K1", answers: [{ questionId: "ok", optionIds: ["yes"] }] }, messageId: "m", answeredAt: T });
    expect(await ask({ ...brief, resolves: ["dec_K1"] })).toContain("resolves dec_K1 is already answered by the owner");
    expect(await store.isResolved("dec_K1")).toBe(false);
  });

  it("плохой id в списке не даёт пометить хороший", async () => {
    const { ask, store, signals } = await host();
    await ask(clarify("Хорошее"));
    expect(await ask({ ...brief, resolves: ["dec_K1", "dec_none"] })).toContain("Brief not accepted");
    expect(await store.isResolved("dec_K1")).toBe(false);
    expect(signals()).toEqual([]);
  });
});

describe("наказ агенту", () => {
  it("ответ инструмента: строку директивы вставлять один раз, решённое уточнение закрывать через resolves", async () => {
    const { ask } = await host();
    const result = await ask(brief);
    expect(result).toContain("Paste each directive line once, in the turn that sent it");
    expect(result).toContain("a repeat draws it again");
    expect(result).toContain("close it with resolves in your next ask_decision call");
  });
});
