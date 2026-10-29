// @vitest-environment jsdom
// BBPL-968: модель этапа справа от названия в Выборе этапов — по прототипу владельца; раскрытие — колонки «Провайдер · Модель · Effort».
import { cleanup, configure, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { add, planner, report, stage, stagedBrief } from "../core/stages-fixtures";
import { en } from "../lib/messages/en";
import { ru } from "../lib/messages/ru";
import type { AnswerRecord, DecisionBrief, Execution, StageAnswer, decisionsRpcContract, widgetAgentRpcContract } from "../shared/contract";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));
// Части фронта, которые тянут SDK, — только после загрузки приложения.
const { MarkedGroup } = await import("./agent-cells");
const { emptyDraft, fromAnswer, pickStageExecutor, pickStageModel, stageChoiceIn, toAnswer } = await import("./draft");

// Каталог выбора агента приходит RPC: под нагрузкой полной прогонки его ждать дольше секунды по умолчанию.
configure({ asyncUtilTimeout: 10_000 });

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const OPUS: Execution = { providerId: "claude-code", model: "opus", reasoningLevel: "high" };
const SONNET: Execution = { providerId: "claude-code", model: "sonnet", reasoningLevel: "high" };
const catalog = {
  current: OPUS,
  currentFlowId: null,
  providers: [
    {
      id: "claude-code",
      name: "Claude Code",
      models: [
        { model: "opus", name: "Opus", efforts: ["medium" as const, "high" as const], defaultEffort: "high" as const },
        { model: "sonnet", name: "Sonnet", efforts: ["medium" as const, "high" as const], defaultEffort: "medium" as const },
      ],
    },
    { id: "codex", name: "Codex", models: [{ model: "gpt-5-codex", name: "GPT-5 Codex", efforts: ["medium" as const], defaultEffort: "medium" as const }] },
  ],
  flows: [],
};

const spec = stage("spec", { skill: "spec", name: "Spec" });
const implement = stage("implement", { skill: "code-standards-fp", name: "Execution", executors: [planner] });
const land = stage("land", { skill: "", name: "Commit", automation: { source: "flow", steps: ["git.commit"] } });
const reports = [report("spec", { recommended: true, share: { percent: 20, risk: -1 } }), report("implement", { recommended: true, share: { percent: 100, risk: 2 } }), report("land", { recommended: true })];
const brief: DecisionBrief = stagedBrief(reports, {
  stages: { list: [spec, implement, land], minButtonWidth: 170, models: { spec: OPUS, implement: SONNET }, threadModel: OPUS },
  setup: { stages: reports, criteria: [{ text: "Тесты зелёные", add: add(10, 20, 2, 60) }] },
});
const itemOf = (id: string) => ({ stage: brief.stages!.list.find((s) => s.id === id)!, report: reports.find((r) => r.id === id) });

const open = (answer: AnswerRecord | null = null) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof widgetAgentRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer }), answerBrief: () => ({ kind: "not_found" }), widgetAgent: () => catalog, ...({ threadFiles } as object) } },
  );

type Slot = ReturnType<typeof open>;
const row = async (slot: Slot, stageId: string) => {
  await slot.findByRole("group", { name: "Этапы и бюджет" });
  return slot.container.querySelector<HTMLElement>(`[data-stage="${stageId}"]`)!;
};
/** Подпись модели в строке появляется, когда пришёл каталог выбора агента. */
const rowWith = async (slot: Slot, stageId: string, text: string) => {
  await vi.waitFor(async () => expect((await row(slot, stageId)).textContent).toContain(text), { timeout: 4_000 });
  return row(slot, stageId);
};
const sentStages = async (slot: Slot): Promise<StageAnswer[]> => {
  fireEvent.click(slot.getByRole("button", { name: "Отправить ответы" }));
  await vi.waitFor(() => expect(slot.rpcCalls.some((c) => c.method === "answerBrief")).toBe(true));
  return (slot.rpcCalls.find((c) => c.method === "answerBrief")?.input as { answer: { stages: StageAnswer[] } }).answer.stages;
};

describe("колонка выбора доступна таблице этапов", () => {
  it("колонка с галочкой и ✦ экспортируется из ячеек агента", () => {
    expect(typeof MarkedGroup).toBe("function");
  });
});

describe("черновик помнит модель этапа", () => {
  it("без касания — модель плана брифа, после выбора — выбор владельца", () => {
    expect(stageChoiceIn(brief, emptyDraft(), itemOf("implement")).model).toEqual(SONNET);
    const draft = pickStageModel(emptyDraft(), itemOf("implement"), OPUS);
    expect(stageChoiceIn(brief, draft, itemOf("implement")).model).toEqual(OPUS);
  });

  it("ответ несёт модель каждого этапа, а «model» — только у тронутого", () => {
    const answer = toAnswer(brief, pickStageModel(emptyDraft(), itemOf("spec"), SONNET));
    expect(answer.stages?.find((s) => s.id === "spec")).toMatchObject({ model: SONNET, picked: ["model"] });
    const untouched = answer.stages?.find((s) => s.id === "implement");
    expect(untouched?.model).toEqual(SONNET);
    expect(untouched?.picked ?? []).not.toContain("model");
  });

  it("этап на агенте модели в ответ не несёт: граница не меняет модель треда за агента", () => {
    const answer = toAnswer(brief, pickStageExecutor(emptyDraft(), itemOf("implement"), planner.id));
    expect(answer.stages?.find((s) => s.id === "implement")?.model).toBeUndefined();
  });

  it("отвеченный бриф восстанавливает выбранную модель", () => {
    const answer = toAnswer(brief, pickStageModel(emptyDraft(), itemOf("spec"), SONNET));
    expect(stageChoiceIn(brief, fromAnswer(answer), itemOf("spec")).model).toEqual(SONNET);
  });
});

describe("подписи модели этапа есть на обоих языках", () => {
  it("колонки подписаны, чужой провайдер — только новым тредом", () => {
    expect(ru.stages.modelGroup("Spec")).toBe("Spec: модель");
    expect(en.stages.modelGroup("Spec")).toBe("Spec: model");
    expect(ru.stages.newThreadOnly).toBe("только новым тредом");
    expect(en.stages.newThreadOnly).toBe("new thread only");
  });
});

describe("строка этапа показывает и меняет модель", () => {
  it("модель плана справа от названия; у этапа с выбором исполнителя — за Main Agent; автоматизация модели не показывает; ничего не раскрыто", async () => {
    const slot = open();
    expect((await rowWith(slot, "spec", "Opus · High")).textContent).toMatch(/Spec\s*Opus · High/);
    expect((await rowWith(slot, "implement", "Sonnet · High")).textContent).toContain("Main Agent · Sonnet · High");
    const commit = (await row(slot, "land")).textContent ?? "";
    expect(commit).not.toContain("Opus");
    expect(commit).not.toContain("Sonnet");
    expect(slot.queryByRole("group", { name: "Spec: модель" })).toBeNull();
  });

  it("нажатие раскрывает колонки провайдера, модели и effort: галочка у выбранного, ✦ у плана, чужой провайдер недоступен", async () => {
    const slot = open();
    fireEvent.click(within(await rowWith(slot, "spec", "Opus · High")).getByRole("button", { name: "Spec: модель" }));
    const columns = within(slot.getByRole("group", { name: "Spec: модель" }));
    const providers = within(columns.getByRole("group", { name: "Провайдер" }));
    const codex = providers.getByRole("button", { name: /Codex/ });
    expect((codex as HTMLButtonElement).disabled).toBe(true);
    expect(codex.textContent).toContain("только новым тредом");
    const models = within(columns.getByRole("group", { name: "Модель" }));
    const opus = models.getByRole("button", { name: /Opus/ });
    expect(opus.getAttribute("aria-pressed")).toBe("true");
    expect(opus.textContent).toContain("✦");
    expect(within(columns.getByRole("group", { name: "Effort" })).getByRole("button", { name: /High/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("выбор модели в колонке меняет подпись строки и уходит в ответ", async () => {
    const slot = open();
    fireEvent.click(within(await rowWith(slot, "spec", "Opus · High")).getByRole("button", { name: "Spec: модель" }));
    fireEvent.click(within(within(slot.getByRole("group", { name: "Spec: модель" })).getByRole("group", { name: "Модель" })).getByRole("button", { name: /Sonnet/ }));
    expect((await rowWith(slot, "spec", "Sonnet · High")).textContent).not.toContain("Opus");
    const stages = await sentStages(slot);
    expect(stages.find((s) => s.id === "spec")).toMatchObject({ model: SONNET, picked: ["model"] });
    expect(stages.find((s) => s.id === "implement")?.model).toEqual(SONNET);
  });

  it("исполнитель-агент показан своей моделью, колонок модели у него нет", async () => {
    const slot = open();
    fireEvent.click(within(await rowWith(slot, "implement", "Main Agent · Sonnet · High")).getByRole("button", { name: "Execution: исполнитель" }));
    expect(slot.getByRole("group", { name: "Execution: модель" })).toBeTruthy();
    fireEvent.click(within(slot.getByRole("group", { name: "Execution: исполнитель" })).getByRole("button", { name: /planner · opus/ }));
    const agent = await rowWith(slot, "implement", "planner · opus");
    expect(agent.textContent).not.toContain("Sonnet");
    expect(slot.queryByRole("group", { name: "Execution: модель" })).toBeNull();
  });

  it("отвеченный бриф показывает выбранную модель и не раскрывается", async () => {
    const answered: AnswerRecord = {
      answer: { briefId: brief.id, answers: [], stages: [{ id: "spec", run: true, executor: "self", model: SONNET, picked: ["model"] }, { id: "implement", run: true, executor: "self", model: SONNET }, { id: "land", run: true, executor: "self" }] },
      messageId: "msg_1",
      answeredAt: "2026-10-27T11:00:00.000Z",
    };
    const slot = open(answered);
    const answeredSpec = await rowWith(slot, "spec", "Sonnet · High");
    expect(within(answeredSpec).queryByRole("button", { name: "Spec: модель" })).toBeNull();
  });
});

describe("карточка брифа показывает модель этапа", () => {
  it("каталог моделей треда доезжает до таблицы этапов: имя модели, а не её id", async () => {
    const slot = open();
    const specRow = await rowWith(slot, "spec", "Opus");
    expect(specRow.textContent).not.toContain("opus ·");
    expect(slot.rpcCalls.some((c) => c.method === "widgetAgent")).toBe(true);
  });
});
