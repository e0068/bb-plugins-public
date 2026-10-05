// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CODE_FLOW, STAGES, add, planner, report, stage, stagedBrief } from "../core/stages-fixtures";
import type { AnswerRecord, DecisionBrief, StageAnswer, decisionsRpcContract } from "../shared/contract";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

/** Задача без выбора исполнителя, Спецификация вне прогона, План с planner и DEV2 кроме Main Agent. */
const fresh = stagedBrief([
  report("task", { recommended: true, add: add(1, 2, -1, 5) }),
  report("spec", { add: add(5, 9, -1, 20) }),
  report("plan", { recommended: true, add: add(4, 7, -1, 15), adds: { [planner.id]: add(2, 4, -1, 10) } }),
]);

const done = stagedBrief([
  report("task", { state: "done", results: [{ label: "BBPL-1", target: "docs/tasks/BBPL-1.md" }] }),
  report("spec", { state: "done", results: [{ label: "spec.md", target: "docs/specs/spec.md" }, { label: "prototype.html", target: "docs/assets/prototype.html" }] }),
  report("plan", { recommended: true }),
]);

const open = (brief: DecisionBrief, answer: AnswerRecord | null = null) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer }), answerBrief: () => ({ kind: "not_found" }), ...({ threadFiles } as object) } },
  );

type Slot = ReturnType<typeof open>;
const row = async (slot: Slot, stageId: string) => {
  await slot.findByRole("group", { name: "Этапы и бюджет" });
  return slot.container.querySelector<HTMLElement>(`[data-stage="${stageId}"]`)!;
};
const sentStages = async (slot: Slot): Promise<StageAnswer[]> => {
  fireEvent.click(slot.getByRole("button", { name: "Отправить бриф" }));
  await vi.waitFor(() => expect(slot.rpcCalls.some((c) => c.method === "answerBrief")).toBe(true));
  return (slot.rpcCalls.find((c) => c.method === "answerBrief")?.input as { answer: { stages: StageAnswer[] } }).answer.stages;
};

describe("исполнитель в строке этапа", () => {
  it("стоит только у этапа, где во Flow есть выбор кроме Main Agent, — сразу за названием", async () => {
    const slot = open(fresh);
    expect((await row(slot, "plan")).textContent).toMatch(/^План\s*Main Agent/);
    expect((await row(slot, "task")).textContent).not.toContain("Main Agent");
    expect(within(await row(slot, "task")).queryByRole("button", { expanded: false })).toBeNull();
  });

  it("нажатие на этап раскрывает исполнителей строками с ценой; выбор ставит галочку и сворачивает список", async () => {
    const slot = open(fresh);
    fireEvent.click(within(await row(slot, "plan")).getByRole("button", { name: "План: исполнитель" }));
    const list = within(slot.getByRole("group", { name: "План: исполнитель" }));
    const pickPlanner = list.getByRole("button", { name: /planner · opus/ });
    expect(pickPlanner.textContent).toContain("+$6–+$11");
    fireEvent.click(pickPlanner);
    expect(slot.queryByRole("group", { name: "План: исполнитель" })).toBeNull();
    expect((await row(slot, "plan")).textContent).toContain("planner · opus");
    expect((await sentStages(slot)).find((s) => s.id === "plan")).toMatchObject({ run: true, executor: planner.id });
  });

  it("снятый этап гасит исполнителя: его не видно и строка не раскрывается", async () => {
    const slot = open(fresh);
    fireEvent.click(within(await row(slot, "plan")).getByRole("checkbox", { name: "План: в ближайший прогон" }));
    const plan = await row(slot, "plan");
    expect(plan.textContent).not.toContain("Main Agent");
    expect(within(plan).queryByRole("button", { name: "План: исполнитель" })).toBeNull();
  });
});

describe("колонка галочек", () => {
  it("этап в прогоне — отмеченный чекбокс, как в прогресс-баре, снятый — пустой; нажатие переключает", async () => {
    const slot = open(fresh);
    const task = within(await row(slot, "task")).getByRole("checkbox", { name: "Задача: в ближайший прогон" });
    const spec = within(await row(slot, "spec")).getByRole("checkbox", { name: "Спецификация: в ближайший прогон" });
    expect(task.getAttribute("aria-checked")).toBe("true");
    expect(spec.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(spec);
    expect(spec.getAttribute("aria-checked")).toBe("true");
    expect((await sentStages(slot)).find((s) => s.id === "spec")).toMatchObject({ run: true });
  });

  it("снятый этап зачёркнут без риска, времени, цели и потолка и в итог не входит", async () => {
    const slot = open(fresh);
    const spec = await row(slot, "spec");
    expect(spec.textContent).not.toContain("$");
    expect(spec.textContent).not.toContain("r");
    expect(spec.querySelector(".line-through")).toBeTruthy();
    const total = (await slot.findByRole("group", { name: "Этапы и бюджет" })).querySelector("[data-total]")!.textContent;
    expect(total).toContain("$5–$9");
  });

  it("автоматизация — галочка без цены и без исполнителя", async () => {
    const automation = CODE_FLOW.find((s) => s.automation !== undefined)!;
    const slot = open(stagedBrief([report(automation.id, { recommended: true })], { stages: { list: [automation], minButtonWidth: 170 } }));
    const line = await row(slot, automation.id);
    expect(within(line).getByRole("checkbox", { name: /в ближайший прогон/ }).getAttribute("aria-checked")).toBe("true");
    expect(line.textContent).not.toContain("$");
  });
});

describe("пройденный этап", () => {
  it("галочка без чекбокса и ссылка на первый результат", async () => {
    const slot = open(done);
    const task = within(await row(slot, "task"));
    expect(task.getByLabelText("Этап сделан")).toBeTruthy();
    expect(task.queryByRole("checkbox", { name: /в ближайший прогон/ })).toBeNull();
    expect(task.getByRole("link", { name: /BBPL-1/ })).toBeTruthy();
  });

  it("клик по имени файла открывает его и строку не раскрывает", async () => {
    const slot = open(done);
    const spec = within(await row(slot, "spec"));
    fireEvent.click(spec.getByRole("link", { name: /spec\.md/ }));
    expect(spec.getByRole("button", { name: "Спецификация" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("и с одним результатом раскрывается строкой, где путь можно скопировать", async () => {
    const slot = open(done);
    fireEvent.click(within(await row(slot, "task")).getByRole("button", { name: "Задача" }));
    expect(within(slot.getByRole("group", { name: "Задача: результаты" })).getByRole("button", { name: /Скопировать путь/ })).toBeTruthy();
  });

  it("с несколькими результатами раскрывается списком всех", async () => {
    const slot = open(done);
    expect(slot.queryByRole("group", { name: "Спецификация: результаты" })).toBeNull();
    fireEvent.click(within(await row(slot, "spec")).getByRole("button", { name: "Спецификация" }));
    expect(within(slot.getByRole("group", { name: "Спецификация: результаты" })).getAllByText(/spec\.md|prototype\.html/).length).toBeGreaterThanOrEqual(2);
  });
});

describe("под-этап", () => {
  it("своей строкой с отступом и своей галочкой, которая называет этап-владелец", async () => {
    const demo = stage("demo", { name: "Показ", parent: "plan" });
    const slot = open(stagedBrief([report("plan", { recommended: true }), report("demo", { recommended: true })], { stages: { list: [...STAGES, demo], minButtonWidth: 170 } }));
    const line = await row(slot, "demo");
    expect(within(line).getByRole("checkbox", { name: "Под-этап Показ этапа План в прогоне" }).getAttribute("aria-checked")).toBe("true");
    expect(line.querySelector(".pl-4")).toBeTruthy();
  });
});

describe("снимок отвеченного брифа", () => {
  const answered = (lines: NonNullable<AnswerRecord["forecast"]>["lines"]): AnswerRecord => ({
    answer: { briefId: fresh.id, answers: [], stages: [{ id: "task", run: true, executor: "self" }, { id: "spec", run: false, executor: "self" }, { id: "plan", run: true, executor: "self" }] },
    messageId: "msg_1",
    answeredAt: "2026-09-15T01:00:00.000Z",
    forecast: { lines, minutes: 20, risk: 0, target: 5, max: 9 },
  });

  it("строка с меткой этапа встаёт в его строку, остальное — своими строками", async () => {
    const slot = open(fresh, answered([{ label: "План", note: "Сам", minutes: 15, risk: 0, target: 4.5, max: 7.5, stage: "plan" }, { label: "Вопрос 1", note: "вариант", minutes: null, risk: 1, target: 0, max: 0 }]));
    expect((await row(slot, "plan")).textContent).toContain("+$4.5–+$7.5");
    const lines = [...(await slot.findByRole("group", { name: "Этапы и бюджет" })).querySelectorAll("[data-line]")].map((l) => l.textContent);
    expect(lines).toEqual([expect.stringContaining("Вопрос 1")]);
  });

  it("снимок, записанный до меток, узнаёт строку этапа по названию", async () => {
    const slot = open(fresh, answered([{ label: "План", note: "Сам", minutes: 15, risk: 0, target: 4.5, max: 7.5 }]));
    expect((await row(slot, "plan")).textContent).toContain("+$4.5–+$7.5");
    expect((await slot.findByRole("group", { name: "Этапы и бюджет" })).querySelectorAll("[data-line]")).toHaveLength(0);
  });
});
