// @vitest-environment node
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";

import { stage } from "../core/stages-fixtures";
import type { FlowProgress, StageSettings, WorkStage } from "../shared/contract";
import { ASK_TOOL_NAME, registerAskTool } from "./ask-tool";
import { FLOW_STAGE_TOOL, createProgress, registerProgress } from "./progress";
import { createStore } from "./store";

const THREAD = "thr_n364he4z6h";
const T0 = "2026-10-09T18:00:00.000Z";
const T1 = "2026-10-09T18:20:00.000Z";

/** Тред SHA-201: Вопросы, Definition of Done, Выбор этапов и task-flow пройдены, Implementation впереди. */
const STAGES: WorkStage[] = [
  { id: "questions", kind: "questions", skill: "", name: "Questions", executors: [] },
  { id: "criteria", kind: "criteria", skill: "", name: "Definition of Done", executors: [] },
  { id: "select", kind: "select", skill: "", name: "Stage selection", executors: [] },
  stage("task", { skill: "task-flow", name: "task-flow" }),
  stage("implement", { skill: "code-standards-fp", name: "Implementation" }),
  { id: "demo", kind: "demo", skill: "", name: "Demonstration", executors: [] },
];

const LAUNCHED: FlowProgress = {
  stages: Object.fromEntries(["questions", "criteria", "select", "task"].map((id) => [id, { startedAt: T0, finishedAt: T0 }])),
  waiting: [],
};

const textOf = (result: unknown): string =>
  typeof result === "string" ? result : ((result as { content?: Array<{ text?: string }> }).content ?? []).map((c) => c.text ?? "").join("");

const setup = async () => {
  const settings: StageSettings = { stages: STAGES, minButtonWidth: 170 };
  const { bb, harness } = createFakePluginHost({ pluginId: "flow" });
  await bb.storage.kv.set(`flow-progress:${THREAD}`, LAUNCHED);
  const store = createStore(bb.storage.kv);
  await store.markLaunched(THREAD);
  const progress = createProgress(bb.storage.kv);
  registerProgress(bb, progress, { now: () => T1, stages: () => settings, windowCost: async () => undefined });
  let n = 0;
  registerAskTool(bb, store, { newId: () => `R${++n}`, now: () => T1, stages: () => settings, progress });
  const mark = async (id: string, state: "started" | "done") => textOf(await harness.callAgentTool(FLOW_STAGE_TOOL, { stage: id, state }, { threadId: THREAD }));
  const ask = async (input: unknown) => textOf(await harness.callAgentTool(ASK_TOOL_NAME, input, { threadId: THREAD }));
  const finished = async (id: string) => (await progress.get(THREAD))?.stages[id]?.finishedAt !== undefined;
  return { mark, ask, finished };
};

const fork = {
  title: "Где хранится пустая папка",
  questions: [
    { id: "storage", question: "Где хранить пустую папку?", kind: "fork", options: [
      { id: "list", action: "Список путей", description: "Файл со списком папок", cost: "$0", risk: "S" },
      { id: "dirs", action: "Настоящая папка", description: "Каталог на диске", cost: "$12", risk: "L" },
    ] },
  ],
};

const reopenedStages = [
  { id: "questions", state: "done" },
  { id: "criteria", state: "todo" },
  { id: "select", state: "todo" },
  { id: "task", state: "done", results: [{ label: "SHA-201", target: "SHA-201" }] },
  { id: "implement", state: "todo", recommended: true, executor: "self", share: { percent: 100, risk: 0 } },
  { id: "demo", state: "todo", recommended: true },
];

describe("откат Flow к этапу", () => {
  it("тред SHA-201: отметка started на Definition of Done снимает готовность с Выбора этапов и всех этапов после него, этапы до него не тронуты", async () => {
    const { mark, finished } = await setup();
    await mark("criteria", "started");
    expect(await finished("criteria")).toBe(false);
    expect(await finished("select")).toBe(false);
    expect(await finished("task")).toBe(false);
    expect(await finished("questions")).toBe(true);
  });

  it("тред SHA-201: бриф с развилкой после запуска без отката к Definition of Done отклоняется и называет, к какому этапу откатиться", async () => {
    const { ask } = await setup();
    const result = await ask(fork);
    expect(result).toContain("Brief not accepted");
    expect(result).toContain("criteria");
  });

  it("тред SHA-201: после отката к Definition of Done бриф с развилкой, критериями и выбором этапов принимается", async () => {
    const { mark, ask } = await setup();
    await mark("criteria", "started");
    const result = await ask({ ...fork, scope: "- Пустая папка", setup: { criteria: [{ text: "Пустая папка переживает перезапуск", add: { target: 12, max: 25, risk: 4, minutes: 60 } }], stages: reopenedStages } });
    expect(result).toMatch(/::decision\{id="dec_R\d+"\}/);
  });

  it("тред SHA-201: после отката к Definition of Done бриф с одной развилкой без Definition of Done в setup.stages отклоняется — иначе прогон встал бы на откатанном этапе", async () => {
    const { mark, ask } = await setup();
    await mark("criteria", "started");
    const result = await ask(fork);
    expect(result).toContain("Brief not accepted");
    expect(result).toContain("criteria");
  });

  it("демонстрация после запуска проходит без отката", async () => {
    const { ask } = await setup();
    const result = await ask({ title: "Готово", outcome: { stage: "demo", final: true, done: ["Две кнопки под деревом"], pending: [], results: [{ label: "Проверить", command: "bb thread show thr_n364he4z6h" }] } });
    expect(result).toMatch(/::decision\{id="dec_R\d+"\}/);
  });

  it("уточнение да/нет после запуска проходит без отката", async () => {
    const { ask } = await setup();
    const result = await ask({ title: "Папку назвать «Папка»?", kind: "clarify", questions: [{ id: "word", question: "Назвать «Папка»?", kind: "yesno", options: [{ id: "yes", action: "Yes" }, { id: "no", action: "No" }] }] });
    expect(result).toMatch(/::decision\{id="dec_R\d+"\}/);
  });
});
