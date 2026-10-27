// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionAnswer, StageSettings } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { returnAwaitingBrief } from "./brief-return";
import { priced } from "./priced-fixture";
import { createStore } from "./store";

const THREAD = "thr_settled";
const T = "2026-10-26T10:00:00.000Z";
const withApproval: StageSettings = { stages: [builtinStage("questions", []), builtinStage("approve", [])], minButtonWidth: 160 };
const withoutApproval: StageSettings = { stages: [builtinStage("questions", [])], minButtonWidth: 160 };

const questions = (title: string, settings: StageSettings) =>
  priced({ title, questions: [{ id: "go", kind: "confirm", question: "Так?", options: [{ id: "yes", action: "Да", recommended: true }] }], setup: { stages: settings.stages.map((s) => ({ id: s.id, state: "todo" })) } });

// Вопросы до запуска с утверждением впереди ход не держат: в списке ждущих их нет, как в треде владельца с 6154ca03.
const host = async (settings = withApproval) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  let n = 0;
  registerAskTool(bb, store, { newId: () => `S${++n}`, now: () => T, stages: () => settings });
  await harness.callAgentTool(ASK_TOOL_NAME, questions("Вопросы", settings), { threadId: THREAD });
  const published: string[] = [];
  const message = () => returnAwaitingBrief({ store, publish: (id) => void published.push(id) }, THREAD);
  const askAgain = () => harness.callAgentTool(ASK_TOOL_NAME, questions("Вопросы снова", settings), { threadId: THREAD });
  return { store, published, message, askAgain };
};

describe("сообщение в чат при открытом виджете Вопросов, который прогон не держит", () => {
  it("сворачивает виджет в строку «отправлены обратно агенту»", async () => {
    const { store, published, message } = await host();
    expect((await store.getBrief("dec_S1"))?.settle).toBe("approval");
    expect(await store.listAwaiting()).toEqual([]);
    expect(await message()).toBe("dec_S1");
    expect(published).toEqual(["dec_S1"]);
    expect(await store.getFold("dec_S1")).toEqual({ holder: "dec_S1", ids: ["dec_S1"] });
    expect(await store.getThreadReturned(THREAD)).toBe("dec_S1");
  });

  it("выборы, отмеченные в свёрнутом виджете, стоят отмеченными в следующем виджете агента", async () => {
    const { store, message, askAgain } = await host();
    await store.putDraft("dec_S1", "{черновик}");
    await message();
    await askAgain();
    expect((await store.getBrief("dec_S2"))?.restored?.sources?.map((s) => s.draft)).toEqual(["{черновик}"]);
  });

  it("отвеченный виджет сообщение не трогает", async () => {
    const { store, published, message } = await host();
    const answer: DecisionAnswer = { briefId: "dec_S1", answers: [{ questionId: "go", optionIds: ["yes"] }] };
    await store.putAnswer("dec_S1", { answer, messageId: "m", answeredAt: T });
    expect(await message()).toBeNull();
    expect(published).toEqual([]);
    expect(await store.getFold("dec_S1")).toBeNull();
  });

  it("второе сообщение подряд виджет повторно не возвращает", async () => {
    const { published, message } = await host();
    await message();
    expect(await message()).toBeNull();
    expect(published).toEqual(["dec_S1"]);
  });

  it("виджет, который агент решил сам без Утверждения впереди, сообщение не сворачивает: он только показывает решение", async () => {
    const { store, published, message } = await host(withoutApproval);
    expect((await store.getBrief("dec_S1"))?.settle).toBe("agent");
    expect(await message()).toBeNull();
    expect(published).toEqual([]);
    expect(await store.getFold("dec_S1")).toBeNull();
  });
});
