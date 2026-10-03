// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { STAGES } from "../core/stages-fixtures";
import type { FlowProgress, StageSettings } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const settings: StageSettings = { stages: STAGES, minButtonWidth: 190 };

const THREAD = "thr_run";

const running: FlowProgress = { stages: {}, waiting: [], planned: { minutes: 175, target: 35, max: 63 } };

const host = async (progress: FlowProgress | null) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  await store.markLaunched(THREAD);
  let n = 0;
  registerAskTool(bb, store, {
    newId: () => `S${++n}`,
    now: () => "2026-10-03T10:00:00.000Z",
    stages: () => settings,
    progress: { recordBrief: async () => undefined, get: async () => progress },
  });
  const idOf = (result: unknown) => /id="(dec_[^"]+)"/.exec(typeof result === "string" ? result : "")?.[1] ?? "";
  const ask = (input: unknown) => harness.callAgentTool(ASK_TOOL_NAME, input, { threadId: THREAD });
  return { store, idOf, ask };
};

const question = {
  title: "Через какой канал",
  questions: [
    { id: "how", question: "Канал?", kind: "fork", options: [
      { id: "feed", action: "Лента", description: "Раз в 2 минуты", add: { target: 2, max: 3, risk: 1 } },
      { id: "push", action: "Ретранслятор", description: "Мгновенно", add: { target: 4, max: 6, risk: 2 } },
    ] },
  ],
};

const outcome = {
  stage: STAGES[0]?.id ?? "task",
  final: false,
  next: "Спецификация",
  done: ["Задача заведена"],
  pending: [],
  results: [{ label: "task.md", target: "docs/tasks/task.md" }],
};

describe("утверждённый бюджет в брифе посреди работы", () => {
  it("бриф-уточнение посреди работы несёт утверждённый бюджет прогона", async () => {
    const { ask, store, idOf } = await host(running);
    const brief = await store.getBrief(idOf(await ask(question)));
    expect(brief?.approvedBudget).toEqual({ minutes: 175, target: 35, max: 63 });
  });

  it("прогон без плана утверждённого бюджета брифу не даёт", async () => {
    const { ask, store, idOf } = await host({ stages: {}, waiting: [] });
    const brief = await store.getBrief(idOf(await ask(question)));
    expect(brief?.approvedBudget).toBeUndefined();
  });

  it("Демонстрация посреди работы утверждённого бюджета не несёт", async () => {
    const { ask, store, idOf } = await host(running);
    const brief = await store.getBrief(idOf(await ask({ title: "Итог", outcome })));
    expect(brief?.approvedBudget).toBeUndefined();
  });
});
