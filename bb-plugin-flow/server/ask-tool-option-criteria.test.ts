// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { STAGES } from "../core/stages-fixtures";
import type { StageSettings } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const settings: StageSettings = { stages: STAGES, minButtonWidth: 190 };
const THREAD = "thr_option_criteria";

const host = async (launched = false) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  if (launched) await store.markLaunched(THREAD);
  registerAskTool(bb, store, { newId: () => "B1", now: () => "2026-10-02T10:00:00.000Z", stages: () => settings });
  return (input: unknown) => harness.callAgentTool(ASK_TOOL_NAME, input, { threadId: THREAD });
};

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

const price = { target: 2, max: 3, risk: 0, minutes: 15 };
const stages = [
  { id: "task", state: "todo", recommended: true, share: { percent: 5, risk: 0 } },
  { id: "spec", state: "todo", recommended: false, share: { percent: 15, risk: -1 } },
  { id: "plan", state: "todo", recommended: true, share: { percent: 100, risk: 1 } },
];

/** Вопрос брифа BBPL-505: где виден этап — варианты с ценой и без. */
const where = (progress: Record<string, unknown> = {}) => ({
  id: "where",
  kind: "pick",
  question: "Где этап должен быть виден как группа шагов?",
  options: [
    { id: "settings", action: "Таблица на странице Flow", description: "входит в основу", recommended: true },
    { id: "progress", action: "Полоса прогресса над композером", description: "сегменты по этапам", recommended: true, add: { target: 10, max: 18, risk: 1, minutes: 45 }, ...progress },
  ],
});

const brief = (question: unknown) => ({ title: "Этапы", scope: "- этапы", setup: { criteria: [{ text: "Таблица группирует строки", add: price }], stages }, questions: [question] });

describe("ask_decision: вариант с ценой несёт свои пункты «Готово, когда»", () => {
  it("бриф BBPL-505 — вариант с ценой без пунктов — отклонён с именем варианта", async () => {
    const text = textOf(await (await host())(brief(where())));
    expect(text).toContain("Brief not accepted");
    expect(text).toContain("where/progress");
  });

  it("тот же вариант со своим пунктом принят", async () => {
    const text = textOf(await (await host())(brief(where({ criteria: ["Полоса прогресса делит сегменты по этапам"] }))));
    expect(text).toContain("::decision");
  });

  it("вариант без цены и вариант с нулевой ценой пунктов не требуют", async () => {
    const fork = {
      id: "keep",
      kind: "fork",
      question: "Как быть с шагами автоматизации?",
      options: [
        { id: "as-is", action: "Оставить как есть", description: "ничего не меняется", recommended: true, add: { target: 0, max: 0, risk: 1, minutes: 0 } },
        { id: "rename", action: "Переименовать", description: "новое слово", add: { target: 2, max: 4, risk: 0, minutes: 10 }, criteria: ["Шаги автоматизации называются действиями"] },
      ],
    };
    expect(textOf(await (await host())(brief(fork)))).toContain("::decision");
  });

  it("вопрос посреди запущенной работы пунктов на вариантах не требует", async () => {
    expect(textOf(await (await host(true))({ title: "Развилка", questions: [where()] }))).toContain("::decision");
  });
});
