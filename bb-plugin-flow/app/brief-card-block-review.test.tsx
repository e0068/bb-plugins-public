// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SETUP_ROW } from "../core/rows";
import type { AnswerRecord, DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_block_review",
  threadId: "thr_1",
  title: "Нижний блок с ревью и тестированием",
  createdAt: "2026-09-14T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  planning: { minutes: 42, cost: 4.2 },
  setup: {
    artifacts: [
      { id: "task", name: "Задача", state: "approved", recommended: false, link: { label: "SL-1", target: "docs/tasks/todo/sl-1.md" } },
      { id: "prototype", name: "HTML-прототип", state: "ready", recommended: true, link: { label: "p.html", target: "docs/assets/p.html" } },
      { id: "spec", name: "Спецификация", state: "missing", recommended: true, add: { target: 2, max: 4, risk: -2 } },
      { id: "plan", name: "План", state: "missing", recommended: false },
    ],
    executor: { recommended: "subagents", adds: { subagents: { target: 4, max: 8, risk: 1 } } },
    checker: { recommended: "agent", models: [{ name: "Opus 5", recommended: true }] },
    testing: { recommended: "self" },
  },
  questions: [{ id: "read", question: "Так?", kind: "confirm", allowOwn: false, options: [{ id: "yes", action: "Да", recommended: true }] }],
};

type Rpc = { getBrief: () => unknown; answerBrief: () => unknown };

const render = (rpc: Rpc) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: rpc as never },
  );

const open = (answerBrief: () => unknown = () => ({ kind: "not_found" })) => render({ getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief });

type Slot = ReturnType<typeof render>;
const block = async (slot: Slot) => within(await slot.findByRole("group", { name: "Ответ на бриф" }));

describe("блок первой части с ревью и тестированием", () => {
  it("артефакты, кнопки исполнителя, ревью, тестирования и бюджета, поле и нижняя строка лежат в одной группе", async () => {
    const group = await block(open());
    expect(group.getByRole("group", { name: "Артефакты" })).toBeTruthy();
    for (const name of [/^Исполняет/, /^Ревью/, /^Тестирование/, /^Бюджет/]) expect(group.getByRole("button", { name })).toBeTruthy();
    expect(group.queryByRole("button", { name: /^Приоритет/ })).toBeNull();
    expect(group.getByRole("textbox", { name: "Дополнить бриф" })).toBeTruthy();
    expect(group.getByRole("button", { name: "Исполнять" })).toBeTruthy();
    expect(group.getByText("заполнено 4/5")).toBeTruthy();
    const send = group.getByRole("button", { name: "Отправить бриф" });
    expect(send.className).toContain("bg-foreground");
    expect(send.hasAttribute("disabled")).toBe(true);
    expect(group.getByRole("button", { name: /^Ревью/ }).className).not.toContain("bg-foreground");
  });

  it("кнопка несёт подпись и уже выбранную рекомендацию агента", async () => {
    const group = await block(open());
    expect(group.getByRole("button", { name: /^Исполняет/ }).textContent).toContain("Субагенты");
    expect(group.getByRole("button", { name: /^Ревью/ }).textContent).toContain("Сторонний агент на Opus 5");
    expect(group.getByRole("button", { name: /^Тестирование/ }).textContent).toContain("Сам");
  });

  it("ревью и тестирование в рамках workflow нельзя выбрать, пока исполняет не workflow", async () => {
    const group = await block(open());
    for (const row of ["Ревью", "Тестирование"]) {
      fireEvent.click(group.getByRole("button", { name: new RegExp(`^${row}`) }));
      expect(within(group.getByRole("group", { name: row })).getByRole("button", { name: /В рамках workflow/ }).hasAttribute("disabled")).toBe(true);
    }
  });

  it("добавка артефакта — отдельной строкой под именем, частями", async () => {
    const slot = open();
    await block(slot);
    const cell = within(slot.container.querySelector<HTMLElement>('[data-artifact="spec"]')!);
    expect(cell.getByText("Спецификация")).toBeTruthy();
    expect(cell.getByText("+$2–4")).toBeTruthy();
    expect(cell.getByText("–2r")).toBeTruthy();
  });

  it("добавка варианта в раскрытом выборе — под действием, частями", async () => {
    const group = await block(open());
    fireEvent.click(group.getByRole("button", { name: /^Исполняет/ }));
    const option = within(group.getByRole("group", { name: "Исполняет" }).querySelector<HTMLElement>("button[aria-pressed]:nth-of-type(2)")!);
    expect(option.getByText("Субагенты")).toBeTruthy();
    expect(option.getByText("+$4–8")).toBeTruthy();
    expect(option.getByText("+1r")).toBeTruthy();
  });

  it("незакрытые строки названы одной строкой под блоком новыми подписями", async () => {
    const slot = open(() => ({ kind: "incomplete", questionIds: [SETUP_ROW.checker, SETUP_ROW.testing] }));
    fireEvent.click(within(await slot.findByRole("group", { name: "Так?" })).getByRole("button", { name: /Да/ }));
    fireEvent.click(slot.getByRole("button", { name: "Отправить бриф" }));
    expect(await slot.findByText("Нужен ответ: Ревью, Тестирование")).toBeTruthy();
    expect((await block(slot)).queryByText(/нужен ответ/i)).toBeNull();
  });

  it("отправка несёт строки артефактов, исполнителя, ревью и тестирования", async () => {
    const slot = open();
    fireEvent.click(within(await slot.findByRole("group", { name: "Так?" })).getByRole("button", { name: /Да/ }));
    fireEvent.click(slot.getByRole("button", { name: "Отправить бриф" }));
    await vi.waitFor(() => expect(slot.rpcCalls.some((c) => c.method === "answerBrief")).toBe(true));
    const call = slot.rpcCalls.find((c) => c.method === "answerBrief")?.input as { answer: { answers: Array<{ questionId: string; optionIds: string[] }> } };
    expect(call.answer.answers.slice(0, 4).map(({ questionId, optionIds }) => ({ questionId, optionIds }))).toEqual([
      { questionId: SETUP_ROW.artifacts, optionIds: ["task", "prototype", "spec"] },
      { questionId: SETUP_ROW.executor, optionIds: ["subagents"] },
      { questionId: SETUP_ROW.checker, optionIds: ["agent:Opus 5"] },
      { questionId: SETUP_ROW.testing, optionIds: ["self"] },
    ]);
  });

  it("отвеченный бриф рисует артефакты и кнопки тем же блоком, без поля и кнопок низа", async () => {
    const record: AnswerRecord = {
      answer: {
        briefId: brief.id,
        answers: [
          { questionId: SETUP_ROW.artifacts, optionIds: ["task", "prototype"] },
          { questionId: SETUP_ROW.executor, optionIds: ["self"] },
          { questionId: SETUP_ROW.checker, optionIds: ["none"] },
          { questionId: SETUP_ROW.testing, optionIds: ["self"] },
          { questionId: "read", optionIds: ["yes"] },
        ],
      },
      messageId: "msg_1",
      answeredAt: "2026-09-14T10:00:00.000Z",
    };
    const slot = render({ getBrief: () => ({ kind: "found", brief, answer: record }), answerBrief: () => ({ kind: "not_found" }) });
    await slot.findByText("Бриф отвечен");
    const group = await block(slot);
    expect(group.getByText("Нет")).toBeTruthy();
    expect(group.getByText("Спецификация")).toBeTruthy();
    expect(group.queryByRole("textbox")).toBeNull();
    expect(group.queryByText("Отправить бриф")).toBeNull();
  });
});

describe("записанный бриф с приоритетом", () => {
  it("открывается без кнопки приоритета и отправляется", async () => {
    const old = { ...brief, id: "dec_old_priority", setup: { ...brief.setup, priority: { options: [{ id: "speed", action: "Скорость", recommended: false }, { id: "quality", action: "Качество", recommended: true }] } } } as DecisionBrief;
    const slot = renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
      app.messageDirectives[0]!,
      { attributes: { id: old.id }, source: `::decision{id="${old.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
      { rpc: { getBrief: () => ({ kind: "found", brief: old, answer: null }), answerBrief: () => ({ kind: "not_found" }) } },
    );
    const group = await block(slot);
    expect(group.queryByRole("button", { name: /^Приоритет/ })).toBeNull();
    fireEvent.click(within(await slot.findByRole("group", { name: "Так?" })).getByRole("button", { name: /Да/ }));
    const send = slot.getByRole("button", { name: "Отправить бриф" });
    expect(send.hasAttribute("disabled")).toBe(false);
    fireEvent.click(send);
    await vi.waitFor(() => expect(slot.rpcCalls.some((c) => c.method === "answerBrief")).toBe(true));
    const call = slot.rpcCalls.find((c) => c.method === "answerBrief")?.input as { answer: { answers: Array<{ questionId: string }> } };
    expect(call.answer.answers.map((a) => a.questionId)).not.toContain("setup.priority");
  });
});
