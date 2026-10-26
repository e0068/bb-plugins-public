// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { STAGES } from "../core/stages-fixtures";
import { builtinStage } from "../lib/stage-constants";
import type { StageSettings } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const THREAD = "thr_clarify";
const T = "2026-10-25T10:00:00.000Z";
const taken = STAGES.map((s) => s.id);
const settings: StageSettings = { stages: [...STAGES, builtinStage("approve", taken)], minButtonWidth: 190 };

const clarify = {
  title: "Что сделать с веткой",
  kind: "clarify",
  questions: [
    { id: "keep", kind: "fork", question: "Ветку оставить?", options: [{ id: "yes", action: "Оставить", description: "Остаётся до решения." }, { id: "no", action: "Удалить", description: "Уходит в архив." }] },
    { id: "pr", kind: "fork", question: "PR закрыть?", options: [{ id: "yes", action: "Закрыть", description: "С причиной." }, { id: "no", action: "Оставить", description: "Как есть." }] },
  ],
};
const approval = { title: "Утверждение", outcome: { stage: "approve", final: false, next: "Дальше", done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] } };

const thread = async () => {
  const ids = ["C1", "C2", "A1"];
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  await store.markLaunched(THREAD);
  registerAskTool(bb, store, { newId: () => ids.shift()!, now: () => T, stages: () => settings });
  const ask = (params: object) => harness.callAgentTool(ASK_TOOL_NAME, params, { threadId: THREAD });
  return { store, ask };
};

describe("уточнение над Утверждением уходит вместе с ним", () => {
  it("неотвеченное уточнение входит в группу Утверждения и ждёт его «Продолжить»", async () => {
    const { store, ask } = await thread();
    await ask(clarify);
    await ask(clarify);
    await ask(approval);
    expect((await store.getBrief("dec_C1"))?.settle).toBe("approval");
    expect((await store.getBrief("dec_C2"))?.settle).toBe("approval");
  });

  it("уточнение, на которое владелец уже ответил или которое агент решил сам, в группу не входит", async () => {
    const { store, ask } = await thread();
    await ask(clarify);
    await store.putAnswer("dec_C1", { answer: { briefId: "dec_C1", answers: [{ questionId: "keep", optionIds: ["yes"] }] }, messageId: "m", answeredAt: T });
    await ask(clarify);
    await store.markResolved("dec_C2");
    await ask(approval);
    expect((await store.getBrief("dec_C1"))?.settle).toBeUndefined();
    expect((await store.getBrief("dec_C2"))?.settle).toBeUndefined();
  });
});
