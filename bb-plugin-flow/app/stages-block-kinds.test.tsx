// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STAGES, add, planner, report, stage, stagedBrief } from "../core/stages-fixtures";
import { builtinStage } from "../lib/stage-constants";
import type { AnswerRecord, DecisionBrief, StageAnswer, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const fresh = stagedBrief([
  report("task", { recommended: true, add: add(1, 2, -1, 5) }),
  report("spec", { add: add(5, 9, -1, 20) }),
  report("plan", { recommended: true, add: add(4, 7, -1, 15), adds: { [planner.id]: add(2, 4, -1, 10) } }),
]);

/** Бриф, записанный до Демонстрации: этап Спецификация ждал приёмки. */
const oldReview = stagedBrief([
  report("task", { state: "done", results: [{ label: "BBPL-1", target: "memory/tasks/BBPL-1.md" }] }),
  report("spec", { state: "review", results: [{ label: "spec.md", target: "memory/specs/spec.md" }] }),
  report("plan", { recommended: true }),
]);

const kinds: DecisionBrief = stagedBrief([report("questions", { state: "done" }), report("select", { recommended: true }), report("spec"), report("demo", { recommended: true })], {
  stages: { list: [builtinStage("questions", []), builtinStage("select", []), stage("spec", { name: "Спека" }), builtinStage("demo", [])], minButtonWidth: 170 },
});

type Options = { answer?: AnswerRecord | null; language?: string; answerBrief?: (input: unknown) => unknown };

const open = (brief: DecisionBrief, options: Options = {}) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    {
      rpc: { getBrief: () => ({ kind: "found", brief, answer: options.answer ?? null }), answerBrief: (options.answerBrief ?? (() => ({ kind: "not_found" }))) as never },
      ...(options.language === undefined ? {} : { settings: { language: options.language } }),
    },
  );

type Slot = ReturnType<typeof open>;
const cell = async (slot: Slot, stageId: string, group = "Ответ на бриф") => {
  await slot.findByRole("group", { name: group });
  return slot.container.querySelector<HTMLElement>(`[data-stage="${stageId}"]`)!;
};

describe("кнопки этапов без Review by User", () => {
  it("кнопка этапа: чекбокс «в прогон», название, добавка и исполнитель; очков нет", async () => {
    const slot = open(fresh);
    const planCell = await cell(slot, "plan");
    const plan = within(planCell);
    expect(plan.getByRole("button", { name: "План: в ближайший прогон" }).getAttribute("aria-pressed")).toBe("true");
    expect(plan.getByText("+15 мин")).toBeTruthy();
    expect(plan.getByText("Сам")).toBeTruthy();
    expect(slot.container.querySelector('[data-icon="Glasses"]')).toBeNull();
  });

  it("раскрытие: «Сам» и исполнители этапа, без Review; выбор исполнителя меняет кнопку и бюджет", async () => {
    const slot = open(fresh);
    const budget = () => slot.getByRole("button", { name: /^Бюджет/ }).textContent ?? "";
    const planCell = await cell(slot, "plan");
    const before = budget();
    fireEvent.click(within(planCell).getByRole("button", { name: "План" }));
    const panel = within(slot.getByRole("group", { name: "План: исполнитель" }));
    expect(panel.getByRole("button", { name: /Сам/ })).toBeTruthy();
    expect(panel.queryByRole("button", { name: /Review/ })).toBeNull();
    fireEvent.click(panel.getByRole("button", { name: /planner/ }));
    expect(within(await cell(slot, "plan")).getByText(/planner/)).toBeTruthy();
    expect(budget()).not.toBe(before);
  });

  it("этап старого брифа, ждавший приёмки, — сделан без чекбокса; приёмки нет, бриф отправляется и ответ без accepted", async () => {
    const answerBrief = vi.fn((_input: unknown) => ({ kind: "not_found" as const }));
    const slot = open(oldReview, { answerBrief });
    const spec = within(await cell(slot, "spec"));
    expect(spec.getByLabelText("Этап сделан")).toBeTruthy();
    expect(spec.queryByRole("button", { name: /в ближайший прогон/ })).toBeNull();
    expect(slot.queryByRole("group", { name: /приёмка/ })).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Отправить бриф" }));
    await waitFor(() => expect(answerBrief).toHaveBeenCalled());
    const stages = (answerBrief.mock.calls[0]![0] as { answer: { stages: StageAnswer[] } }).answer.stages;
    expect(stages.every((s) => !("accepted" in s) && !("review" in s))).toBe(true);
  });

  it("встроенные виды подписаны по языку интерфейса, пройденный встроенный этап галочку не снимает, несделанный — снимает", async () => {
    const slot = open(kinds, { language: "Русский" });
    const text = async (id: string) => (await cell(slot, id)).textContent ?? "";
    expect(await text("questions")).toContain("Вопросы");
    expect(await text("select")).toContain("Выбор этапов");
    expect(await text("demo")).toContain("Демонстрация");
    expect(await text("spec")).toContain("Спека");
    expect(within(await cell(slot, "questions")).queryByRole("button", { name: /в ближайший прогон/ })).toBeNull();
    expect(within(await cell(slot, "demo")).getByRole("button", { name: "Демонстрация: в ближайший прогон" })).toBeTruthy();
  });

  it("по-английски — Questions, Stage selection и Demonstration", async () => {
    const slot = open(kinds, { language: "English" });
    expect((await cell(slot, "select", "Brief answer")).textContent).toContain("Stage selection");
    expect(slot.container.querySelector('[data-stage="demo"]')?.textContent).toContain("Demonstration");
  });

  it("отвеченный бриф: выбранный исполнитель стоит на кнопке, этап старого брифа на приёмке — сделан", async () => {
    const record: AnswerRecord = {
      messageId: "msg_1",
      answeredAt: "2026-09-15T10:00:00.000Z",
      answer: { briefId: oldReview.id, answers: [], stages: [{ id: "plan", run: true, executor: planner.id, picked: ["executor"] }] },
    };
    const slot = open(oldReview, { answer: record });
    await slot.findByText("Бриф отвечен");
    const node = (id: string) => within(slot.container.querySelector<HTMLElement>(`[data-stage="${id}"]`)!);
    expect(node("spec").getByLabelText("Этап сделан")).toBeTruthy();
    expect(node("plan").getByText(/planner/)).toBeTruthy();
    expect(slot.container.textContent).not.toMatch(/не принят/);
  });
});

describe("язык и отправка брифа с этапами", () => {
  it("с настройкой English бриф целиком английский и кнопка — Send", async () => {
    const english: DecisionBrief = { ...fresh, title: "Rename to Flow", stages: { list: STAGES.map((s) => ({ ...s, name: s.id })), minButtonWidth: 170 } };
    const slot = open(english, { language: "English" });
    await slot.findByRole("group", { name: "Brief answer" });
    expect(slot.getByRole("button", { name: "Send brief" }).textContent).toMatch(/Send$/);
    const texts = [slot.container.textContent ?? "", ...[...slot.container.querySelectorAll("[aria-label],[placeholder],[title]")].flatMap((el) => ["aria-label", "placeholder", "title"].map((a) => el.getAttribute(a) ?? ""))];
    expect(texts.filter((t) => /[А-Яа-яЁё]/.test(t))).toEqual([]);
  });

  it("по-русски кнопка отправки подписана «Отправить», имя для чтения с экрана — «Отправить бриф»", async () => {
    const slot = open(fresh);
    await cell(slot, "task");
    expect(slot.getByRole("button", { name: "Отправить бриф" }).textContent).toMatch(/Отправить/);
  });
});
