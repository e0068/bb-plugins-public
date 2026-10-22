// @vitest-environment node
// Демо и уточнение не останавливают ход: агент вставляет их строку сразу, между вызовами инструментов, а bb после хода
// сворачивает такие реплики в «Worked for». Карточка брифа рисуется в последнем сообщении с его строкой, поэтому
// повтор строки в последнем ответе хода держит виджет на виду и после хода.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const THREAD = "thr_final_reply";
const settings: StageSettings = { stages: [builtinStage("demo", [])], minButtonWidth: 190 };

const demo = { title: "Демо", outcome: { stage: "demo", final: true, done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }], documentsOnly: true } };
const clarify = { title: "Уточнение", kind: "clarify", questions: [{ id: "ok", question: "Так?", kind: "yesno", options: [{ id: "yes", action: "Yes" }, { id: "no", action: "No" }] }] };
const brief = { title: "Вопрос", questions: [{ id: "go", kind: "confirm", question: "Так?", options: [{ id: "yes", action: "Yes" }] }] };

const ask = async (input: unknown): Promise<string> => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  await store.markLaunched(THREAD);
  registerAskTool(bb, store, { newId: () => "F1", now: () => "2026-10-15T10:00:00.000Z", stages: () => settings });
  return JSON.stringify(await harness.callAgentTool(ASK_TOOL_NAME, input, { threadId: THREAD }));
};

const REPEAT = "paste the line once more in the final reply of this turn";

describe("виджет, присланный посреди хода, не прячется после хода", () => {
  it("демо: строку сразу и ещё раз в последнем ответе хода, над строкой утверждения", async () => {
    const result = await ask(demo);
    expect(result).toContain(REPEAT);
    expect(result).toContain("above the approval line");
  });

  it("уточнение: строку сразу и ещё раз в последнем ответе хода", async () => {
    expect(await ask(clarify)).toContain(REPEAT);
  });

  it("бриф, который ждёт ответа, кончает ход своей строкой — повторять нечего", async () => {
    expect(await ask(brief)).not.toContain(REPEAT);
  });

  it("строка виджета прошлого хода не повторяется, а решённое уточнение закрывается resolves и сворачивается на месте в строку", async () => {
    const result = await ask(brief);
    expect(result).toContain("never repeat the line of a widget from an earlier turn");
    expect(result).toContain("close it with resolves in your next ask_decision call: its card collapses in place into a");
    expect(result).toContain("Resolved: …");
  });

  it("демо перед брифом, а не утверждением: строку повторяют над той строкой, которой кончается ход", async () => {
    expect(await ask(demo)).toContain("above the approval line or the brief line that ends the turn");
  });

  it("бриф, который кончает ход, напоминает повторить над собой строки демо и уточнений этого хода", async () => {
    expect(await ask(brief)).toContain("paste again above this line the lines of demos and clarifies you sent earlier in this turn");
  });
});
