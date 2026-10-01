// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { STAGES } from "../core/stages-fixtures";
import type { StageSettings } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const settings: StageSettings = { stages: STAGES, minButtonWidth: 190 };
const THREAD = "thr_budget";

const host = async (launched = false) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  if (launched) await store.markLaunched(THREAD);
  registerAskTool(bb, store, { newId: () => "B1", now: () => "2026-10-01T10:00:00.000Z", stages: () => settings });
  return (input: unknown) => harness.callAgentTool(ASK_TOOL_NAME, input, { threadId: THREAD });
};

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

const price = { target: 2, max: 3, risk: 0, minutes: 15 };
const stages = [
  { id: "task", state: "todo", recommended: true, share: { percent: 5, risk: 0 } },
  { id: "spec", state: "todo", recommended: true, share: { percent: 15, risk: -1 } },
  { id: "plan", state: "todo", recommended: true, share: { percent: 100, risk: 5 } },
];

describe("ask_decision не пускает бриф с нулевым бюджетом", () => {
  it("бриф со скриншота — пункты без цены — отклонён с номерами пунктов", async () => {
    const ask = await host();
    const text = textOf(await ask({ title: "Индикаторы", scope: "- логотип", setup: { criteria: ["Логотип крутится", { text: "Колёсико — запасной", add: price }], stages } }));
    expect(text).toContain("Brief not accepted");
    expect(text).toContain("items 1 have no price");
  });

  it("бриф без «Что я понял» отклонён", async () => {
    const ask = await host();
    expect(textOf(await ask({ title: "Бриф", setup: { criteria: [{ text: "Пункт", add: price }], stages } }))).toContain("scope is missing");
  });

  it("этап-навык без доли отклонён по id", async () => {
    const ask = await host();
    const text = textOf(await ask({ title: "Бриф", scope: "- база", setup: { criteria: [{ text: "Пункт", add: price }], stages: [stages[0], { id: "spec", state: "todo", recommended: true }, stages[2]] } }));
    expect(text).toContain("stages spec have no share");
  });

  it("ни одного этапа в прогоне при этапе работы — прогноз $0, отклонён", async () => {
    const ask = await host();
    const idle = stages.map((s) => ({ ...s, recommended: false }));
    expect(textOf(await ask({ title: "Бриф", scope: "- база", setup: { criteria: [{ text: "Пункт", add: price }], stages: idle } }))).toContain("$0");
  });

  it("полный бриф принят", async () => {
    const ask = await host();
    expect(textOf(await ask({ title: "Бриф", scope: "- база", setup: { criteria: [{ text: "Пункт", add: price }], stages } }))).toContain("::decision");
  });

  it("вопрос посреди работы принят без базы", async () => {
    const ask = await host(true);
    const question = { id: "q", kind: "fork", question: "Как?", options: [{ id: "a", action: "А", description: "а", recommended: true, add: { target: 1, max: 1, risk: 0 } }, { id: "b", action: "Б", description: "б", add: { target: 0, max: 0, risk: 0 } }] };
    expect(textOf(await ask({ title: "Развилка", questions: [question] }))).toContain("::decision");
  });

  it("ошибки базы приходят вместе с прочими ошибками брифа одним отказом", async () => {
    const ask = await host();
    const text = textOf(await ask({ title: "Бриф", setup: { criteria: ["Пункт"], stages: stages.slice(1) } }));
    expect(text).toContain("task, spec, plan");
    expect(text).toContain("scope is missing");
  });
});
