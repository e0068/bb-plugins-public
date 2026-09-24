// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DecisionAnswer, DecisionBrief, decisionsRpcContract, dispatchRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_dispatch",
  threadId: "thr_1",
  title: "Куда уходит работа",
  createdAt: "2026-09-16T10:00:00.000Z",
  kind: "brief",
  revocable: true,
  setup: { criteria: ["Тесты зелёные"] },
  questions: [
    { id: "split", question: "Одна задача или две?", kind: "fork", allowOwn: true, options: [
      { id: "one", action: "Одна", recommended: true, description: "Один PR", add: { target: 0, max: 0, risk: 0 } },
      { id: "two", action: "Две", recommended: false, description: "Два PR", add: { target: 3, max: 5, risk: 0 } },
    ] },
    { id: "when", question: "Когда начинать?", kind: "fork", allowOwn: true, options: [
      { id: "now", action: "Сейчас", recommended: true, description: "Сразу", add: { target: 0, max: 0, risk: 0 } },
      { id: "later", action: "Позже", recommended: false, description: "После ревью", add: { target: 0, max: 0, risk: 0 } },
    ] },
  ],
};

const accepted = (input: { answer: DecisionAnswer }) => ({
  kind: "accepted" as const,
  record: { answer: input.answer, messageId: "msg_1", answeredAt: "2026-09-16T10:05:00.000Z" },
});

const open = (handlers: { answerBrief?: typeof accepted; place?: { place: "here" | "thread" | "worktree" } } = {}) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof dispatchRpcContract>(
    app.messageDirectives[0]!,
    {
      attributes: { id: brief.id },
      source: `::decision{id="${brief.id}"}`,
      message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null },
      openWorkspaceFile: () => true,
    },
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief, answer: null }),
        answerBrief: handlers.answerBrief ?? accepted,
        getDispatchPlace: () => handlers.place ?? { place: "here" }, listProjects: () => ({ kind: "found" as const, projects: [] }),
      },
    },
  );

const send = async (slot: ReturnType<typeof open>) => slot.findByRole("button", { name: /Отправить бриф/ });

describe("место исполнения в низу брифа", () => {
  it("кнопки «Принять рекомендации» больше нет", async () => {
    const slot = open();
    await send(slot);
    expect(slot.queryByRole("button", { name: "Принять рекомендации" })).toBeNull();
  });

  it("слева от отправки стоит выбор места, по умолчанию «В этом треде»", async () => {
    const slot = open();
    const place = await slot.findByRole("button", { name: /^Исполнять/ });
    expect(place.textContent).toContain("В этом треде");
  });

  it("место выбирается и при нерешённых вопросах", async () => {
    const slot = open();
    const place = await slot.findByRole("button", { name: /^Исполнять/ });
    expect(place.hasAttribute("disabled")).toBe(false);
    expect((await send(slot)).hasAttribute("disabled")).toBe(true);
  });

  it("последний выбор проекта встаёт при открытии", async () => {
    const slot = open({ place: { place: "thread" } });
    expect((await slot.findByRole("button", { name: /^Исполнять/ })).textContent).toContain("Новый тред");
  });
});

describe("счётчик на отправке", () => {
  it("пока решено не всё, кнопка выключена, а над ней «заполнено 0/2»", async () => {
    const slot = open();
    const button = await send(slot);
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(slot.getByText("заполнено 0/2")).toBeTruthy();
  });

  it("когда решено всё, счётчик исчезает и кнопка включается", async () => {
    const slot = open();
    await send(slot);
    for (const [group, option] of [["Одна задача", "Одна"], ["Когда начинать", "Сейчас"]] as const) {
      fireEvent.click(within(slot.getByRole("group", { name: new RegExp(group) })).getByRole("button", { name: new RegExp(option) }));
    }
    const button = await send(slot);
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(slot.queryByText(/заполнено/)).toBeNull();
  });
});

describe("бриф уже запущенной работы", () => {
  const renderBrief = (shown: DecisionBrief) =>
    renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof dispatchRpcContract>(
      app.messageDirectives[0]!,
      {
        attributes: { id: shown.id },
        source: `::decision{id="${shown.id}"}`,
        message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null },
        openWorkspaceFile: () => true,
      },
      {
        rpc: {
          getBrief: () => ({ kind: "found", brief: shown, answer: null }),
          answerBrief: accepted,
          getDispatchPlace: () => ({ place: "here" }), listProjects: () => ({ kind: "found" as const, projects: [] }),
        },
      },
    );

  it("бриф с меткой запуска не показывает ни бюджета, ни цен у вариантов", async () => {
    const slot = renderBrief({ ...brief, launched: true });
    await slot.findByRole("button", { name: /^Исполнять/ });
    expect(slot.queryByRole("button", { name: /^Бюджет/ })).toBeNull();
    expect(slot.queryByText(/\+\$/)).toBeNull();
  });

  it("бриф до запуска без первой части цены вариантов показывает", async () => {
    const { setup: _setup, ...questionsOnly } = brief;
    const slot = renderBrief(questionsOnly);
    await slot.findByRole("button", { name: /^Исполнять/ });
    expect(slot.getAllByText(/\+\$/).length).toBeGreaterThan(0);
  });
});

describe("отвеченный бриф с передачей", () => {
  it("называет тред, в который уехала работа", async () => {
    const slot = renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof dispatchRpcContract>(
      app.messageDirectives[0]!,
      {
        attributes: { id: brief.id },
        source: `::decision{id="${brief.id}"}`,
        message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null },
        openWorkspaceFile: () => true,
      },
      {
        rpc: {
          getBrief: () => ({
            kind: "found",
            brief,
            answer: {
              answer: { briefId: brief.id, answers: [{ questionId: "split", optionIds: ["one"] }, { questionId: "when", optionIds: ["now"] }], place: "worktree" },
              handoffThreadId: "thr_new",
              messageId: "msg_1",
              answeredAt: "2026-09-16T10:05:00.000Z",
            },
          }),
          answerBrief: accepted,
          getDispatchPlace: () => ({ place: "here" }), listProjects: () => ({ kind: "found" as const, projects: [] }),
        },
      },
    );
    expect(await slot.findByText(/thr_new/)).toBeTruthy();
  });
});

describe("ответ несёт место исполнения", () => {
  it("запомненное место уходит в ответ и без касания ячейки", async () => {
    const answerBrief = vi.fn(accepted);
    const slot = open({ answerBrief, place: { place: "thread" } });
    await vi.waitFor(async () => expect((await slot.findByRole("button", { name: /^Исполнять/ })).textContent).toContain("Новый тред"));
    for (const [group, option] of [["Одна задача", "Одна"], ["Когда начинать", "Сейчас"]] as const) {
      fireEvent.click(within(slot.getByRole("group", { name: new RegExp(group) })).getByRole("button", { name: new RegExp(option) }));
    }
    fireEvent.click(await send(slot));
    await vi.waitFor(() => expect(answerBrief).toHaveBeenCalled());
    expect(answerBrief.mock.calls[0]![0].answer.place).toBe("thread");
  });
});
