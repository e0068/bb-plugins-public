// @vitest-environment node
// BBPL-531: бриф до запуска раскладывает работу между базой и развилкой — самый простой ответ развилки стоит 0 и лежит в базе.
import { readFileSync } from "node:fs";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { STAGES } from "../core/stages-fixtures";
import type { StageSettings } from "../shared/contract";
import { BASE_CRITERIA, REWRITTEN_FORKS } from "../shared/fork-zero-fixtures";
import { ASK_INSTRUCTIONS, ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { createStore } from "./store";

const settings: StageSettings = { stages: STAGES, minButtonWidth: 190 };
const THREAD = "thr_fork_zero";

const host = async (launched = false) => {
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  const store = createStore(bb.storage.kv);
  if (launched) await store.markLaunched(THREAD);
  registerAskTool(bb, store, { newId: () => "Z1", now: () => "2026-10-04T10:00:00.000Z", stages: () => settings });
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
const base = { scope: "- база", setup: { criteria: [{ text: "Общая работа", add: price }, { text: "Фильтр графика сужает и таблицу", add: price }], stages } };

type Add = { target: number; max: number; risk: number; minutes?: number };
const option = (id: string, add: Add, extra: Record<string, unknown> = {}) => ({ id, action: id, description: "Что будет", add, ...extra });
const own = { criteria: ["У таблицы свой фильтр"], removes: [1] };
const brief = (kind: "fork" | "pick", options: unknown[]) => ({ title: "Фильтр", ...base, questions: [{ id: "filter", question: "Чем сужать таблицу?", kind, options }] });

describe("у развилки до запуска самый простой ответ стоит 0", () => {
  it("развилка, где каждый ответ стоит денег, отклонена с её id и правилом", async () => {
    const ask = await host();
    const text = textOf(await ask(brief("fork", [option("own", { target: 2, max: 4, risk: 0, minutes: 10 }, own), option("shared", { target: 1, max: 2, risk: 0, minutes: 5 }, own)])));
    expect(text).toContain("Brief not accepted");
    expect(text).toContain("forks filter have no option for 0");
    expect(text).toContain("simplest option costs 0");
  });

  it("ответ за 0 не стоит и минут: ответ с одними минутами нулём не считается", async () => {
    const ask = await host();
    const text = textOf(await ask(brief("fork", [option("own", { target: 2, max: 4, risk: 0, minutes: 10 }, own), option("shared", { target: 0, max: 0, risk: 0, minutes: 5 })])));
    expect(text).toContain("forks filter have no option for 0");
  });

  it("самый простой ответ за 0 в базе, богатый — добавка со своими пунктами и removes: бриф принят", async () => {
    const ask = await host();
    const text = textOf(await ask(brief("fork", [option("own", { target: 2, max: 4, risk: 0, minutes: 10 }, { recommended: true, ...own }), option("shared", { target: 0, max: 0, risk: 0 })])));
    expect(text).toContain("::decision");
  });

  it("выбор нескольких ответов правилу не подчиняется", async () => {
    const ask = await host();
    const text = textOf(await ask(brief("pick", [option("own", { target: 2, max: 4, risk: 0, minutes: 10 }, own), option("shared", { target: 1, max: 2, risk: 0, minutes: 5 }, own)])));
    expect(text).toContain("::decision");
  });

  it("посреди работы база — утверждённый объём, и оба ответа развилки вправе быть добавкой к нему", async () => {
    const ask = await host(true);
    const question = { id: "how", kind: "fork", question: "Канал?", options: [option("feed", { target: 2, max: 3, risk: 1 }), option("push", { target: 4, max: 6, risk: 2 })] };
    expect(textOf(await ask({ title: "Канал", questions: [question] }))).toContain("::decision");
  });
});

describe("правило цены развилки названо агенту", () => {
  const skill = readFileSync(new URL("../skills/flow/SKILL.md", import.meta.url), "utf8");

  it("описание инструмента и навык кладут в scope самый простой ответ развилки и ставят ему 0", () => {
    expect(ASK_INSTRUCTIONS).toContain("each fork at its simplest answer");
    expect(ASK_INSTRUCTIONS).toContain("The simplest option costs 0");
    expect(skill).toContain("every fork at its simplest answer");
    expect(skill).toContain("A fork is priced from its simplest answer");
  });
});

describe("развилки брифов 02.10, переписанные по правилу, инструмент принимает", () => {
  it.each(Object.entries(REWRITTEN_FORKS))("бриф %s принят до запуска", async (_, question) => {
    const ask = await host();
    const setup = { criteria: BASE_CRITERIA.map((text) => ({ text, add: price })), stages };
    expect(textOf(await ask({ title: "Бриф", scope: "- база", setup, questions: [question] }))).toContain("::decision");
  });
});
