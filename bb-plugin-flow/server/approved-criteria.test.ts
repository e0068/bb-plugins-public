// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { registerApi } from "./api";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { priced } from "./priced-fixture";
import { createStore } from "./store";
import { recommendedForecast } from "../core/budget";

const settings: StageSettings = { stages: [builtinStage("criteria", []), stage("implement", { name: "Реализация" })], minButtonWidth: 190 };
const THREAD = "thr_run";

const host = () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow", sdk: { threads: { send: async () => ({ delivery: "started" }) } } });
  const store = createStore(bb.storage.kv);
  let n = 0;
  registerAskTool(bb, store, { newId: () => `A${++n}`, now: () => "2026-10-01T10:00:00.000Z", stages: () => settings });
  registerApi(bb, store, { now: () => "2026-10-01T10:01:00.000Z" });
  const ask = (input: unknown) => harness.callAgentTool(ASK_TOOL_NAME, input, { threadId: THREAD });
  return { harness, store, ask };
};

const question = {
  id: "how",
  question: "Как рисовать?",
  kind: "fork",
  options: [
    { id: "panel", action: "Панелью", description: "…", recommended: true, add: { target: 2, max: 3, risk: 0 }, criteria: ["Панель не перекрывает ленту"] },
    { id: "pop", action: "Поповером", description: "…", add: { target: 0, max: 0, risk: 0 } },
  ],
};

describe("бриф посреди работы несёт утверждённые пункты", () => {
  it("ответ с правкой владельца — бриф запущенной работы получает итог списка", async () => {
    const { harness, store, ask } = host();
    await ask(priced({ title: "Старт", setup: { criteria: ["Тесты зелёные", "Кнопка на месте"], stages: [{ id: "criteria", state: "todo" }, { id: "implement", state: "todo", recommended: true }] } }));
    await harness.callRpc("answerBrief", {
      id: "dec_A1",
      messageId: "m1",
      answer: { briefId: "dec_A1", answers: [], criteria: { removed: [1], edited: [{ index: 0, text: "Все тесты зелёные" }], added: [] }, stages: [{ id: "implement", run: true, executor: "self" }] },
    });
    await ask({ title: "Развилка", questions: [question] });
    expect((await store.getBrief("dec_A2"))?.approved).toEqual(["Все тесты зелёные"]);
  });

  it("бриф до запуска утверждённых пунктов не получает", async () => {
    const { store, ask } = host();
    await ask(priced({ title: "Старт", questions: [question], setup: { stages: [{ id: "criteria", state: "todo" }, { id: "implement", state: "todo", recommended: true }] } }));
    expect((await store.getBrief("dec_A1"))?.approved).toBeUndefined();
  });
});

describe("цепочка брифов посреди работы", () => {
  it("ответ на вопрос посреди работы дописывает пункт варианта к утверждённым, а не затирает их", async () => {
    const { harness, store, ask } = host();
    await ask(priced({ title: "Старт", setup: { criteria: ["P1", "P2", "P3"], stages: [{ id: "criteria", state: "todo" }, { id: "implement", state: "todo", recommended: true }] } }));
    await harness.callRpc("answerBrief", { id: "dec_A1", messageId: "m1", answer: { briefId: "dec_A1", answers: [], criteria: { removed: [], edited: [], added: [] }, stages: [{ id: "implement", run: true, executor: "self" }] } });
    await ask({ title: "Развилка", questions: [question] });
    await harness.callRpc("answerBrief", { id: "dec_A2", messageId: "m2", answer: { briefId: "dec_A2", answers: [{ questionId: "how", optionIds: ["panel"] }] } });
    await ask({ title: "Ещё развилка", questions: [question] });
    expect((await store.getBrief("dec_A3"))?.approved).toEqual(["P1", "P2", "P3", "Панель не перекрывает ленту"]);
  });

  it("повторный пункт варианта не дублируется", async () => {
    const { harness, store, ask } = host();
    await ask(priced({ title: "Старт", setup: { criteria: ["Панель не перекрывает ленту"], stages: [{ id: "criteria", state: "todo" }, { id: "implement", state: "todo", recommended: true }] } }));
    await harness.callRpc("answerBrief", { id: "dec_A1", messageId: "m1", answer: { briefId: "dec_A1", answers: [], criteria: { removed: [], edited: [], added: [] }, stages: [{ id: "implement", run: true, executor: "self" }] } });
    await ask({ title: "Развилка", questions: [question] });
    await harness.callRpc("answerBrief", { id: "dec_A2", messageId: "m2", answer: { briefId: "dec_A2", answers: [{ questionId: "how", optionIds: ["panel"] }] } });
    await ask({ title: "Ещё развилка", questions: [question] });
    expect((await store.getBrief("dec_A3"))?.approved).toEqual(["Панель не перекрывает ленту"]);
  });

  it("второй выбор этапов посреди работы считает бюджет от утверждённого объёма, а не от нуля", async () => {
    const { harness, store, ask } = host();
    await ask(priced({ title: "Старт", setup: { criteria: ["P1"], stages: [{ id: "criteria", state: "todo" }, { id: "implement", state: "todo", recommended: true }] } }));
    await harness.callRpc("answerBrief", { id: "dec_A1", messageId: "m1", answer: { briefId: "dec_A1", answers: [], criteria: { removed: [], edited: [], added: [] }, stages: [{ id: "implement", run: true, executor: "self" }] } });
    await ask({ title: "Второй выбор", setup: { stages: [{ id: "criteria", state: "todo" }, { id: "implement", state: "todo", recommended: true, share: { percent: 100, risk: 5 } }] } });
    const second = await store.getBrief("dec_A2");
    expect(second === null ? null : recommendedForecast(second).target).toBeGreaterThan(0);
  });
});
