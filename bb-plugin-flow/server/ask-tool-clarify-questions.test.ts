// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { STAGES } from "../core/stages-fixtures";
import type { StageSettings } from "../shared/contract";
import { ASK_INSTRUCTIONS, ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const THREAD = "thr_clarify_questions";
const settings: StageSettings = { stages: STAGES, minButtonWidth: 190 };

const host = async (launched: boolean) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  if (launched) await store.markLaunched(THREAD);
  registerAskTool(bb, store, { newId: () => "C1", now: () => "2026-10-12T10:00:00.000Z", stages: () => settings });
  const ask = (input: unknown) => harness.callAgentTool(ASK_TOOL_NAME, input, { threadId: THREAD });
  return { ask, store };
};

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

/** Развилка без цены: уточнению посреди работы бюджет не считать. */
const fork = {
  id: "ui", kind: "fork", question: "Панель или поповер?",
  options: [
    { id: "panel", action: "Панель", description: "Не перекрывает ленту", recommended: true },
    { id: "pop", action: "Поповер", description: "Перекрывает соседей" },
  ],
};
const pick = { id: "extras", kind: "pick", question: "Что ещё?", options: [{ id: "a", action: "А", description: "а" }, { id: "b", action: "Б", description: "б" }] };
const confirm = { id: "reading", kind: "confirm", question: "Верно понял?", options: [{ id: "yes", action: "Да", recommended: true }] };

describe("уточнение несёт вопросы любого вида", () => {
  it("развилка, выбор нескольких и «верно ли понял» принимаются без цены и не держат работу", async () => {
    const { ask, store } = await host(true);
    const result = textOf(await ask({ title: "Вид списка", kind: "clarify", questions: [fork, pick, confirm] }));
    expect(result).toContain("::decision");
    expect(result).toContain("Keep working");
    expect((await store.getBrief("dec_C1"))?.kind).toBe("clarify");
    expect(await store.listAwaiting()).toEqual([]);
  });

  it("то же уточнение принимается и до запуска работы", async () => {
    const { ask } = await host(false);
    expect(textOf(await ask({ title: "Вид списка", kind: "clarify", questions: [fork] }))).toContain("::decision");
  });

  it("бриф до запуска без цены у варианта по-прежнему отбивается", async () => {
    const { ask } = await host(false);
    await expect(ask({ title: "Вид списка", questions: [fork] })).rejects.toThrow();
  });

  it("уточнение с первой частью отбивается: цены и этапы решает бриф", async () => {
    const { ask } = await host(true);
    await expect(ask({ title: "Вид списка", kind: "clarify", questions: [fork], setup: { criteria: ["Список виден"] } })).rejects.toThrow();
  });

  it("уточнение с итогом этапа отбивается", async () => {
    const { ask } = await host(true);
    const outcome = { stage: "x", final: false, next: "Дальше", done: ["Сделано"], pending: [], results: [{ label: "task.md", target: "docs/tasks/task.md" }], documentsOnly: true as const };
    await expect(ask({ title: "Итог", kind: "clarify", outcome })).rejects.toThrow();
  });

  it("уточнение без вопросов отбивается", async () => {
    const { ask } = await host(true);
    await expect(ask({ title: "Пусто", kind: "clarify", questions: [] })).rejects.toThrow();
  });

  it("инструкции говорят агенту, что останавливаться или нет — решает он", () => {
    expect(ASK_INSTRUCTIONS).toMatch(/clarify[^.]*any question/);
  });
});
