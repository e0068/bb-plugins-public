// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const add = (target: number, max: number, risk: number) => ({ target, max, risk });

const brief: DecisionBrief = {
  id: "dec_budget",
  threadId: "thr_1",
  title: "Бюджет из критериев",
  createdAt: "2026-09-13T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  setup: {
    executor: { recommended: "self", adds: { self: add(0, 0, 0), subagents: add(3, 5, 1) } },
    criteria: [
      { text: "Кнопка бюджета", before: "Два ряда сумм", after: "Одна кнопка", add: add(5, 9, 3) },
      { text: "Риск числом", add: add(2, 4, -1) },
    ],
  },
  questions: [
    { id: "how", question: "Как?", kind: "fork", allowOwn: false, options: [
      { id: "a", action: "Виджет складывает", recommended: true, description: "…", add: add(3, 5, 1) },
      { id: "b", action: "Агент пишет итог", recommended: false, description: "…", add: add(1, 2, 3) },
    ] },
  ],
};

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "not_found" }) } },
  );

type Slot = ReturnType<typeof open>;
const budgetButton = (slot: Slot) => slot.findByRole("button", { name: /^Бюджет/ });

describe("кнопка бюджета", () => {
  it("показывает прогноз «цель · до потолка» и пересчитывает его при снятии пункта и выборе", async () => {
    const slot = open();
    expect((await budgetButton(slot)).textContent).toContain("$7 · до $13");
    fireEvent.click(within(slot.getByRole("group", { name: "Как?" })).getByRole("button", { name: /Виджет складывает/ }));
    expect((await budgetButton(slot)).textContent).toContain("$10 · до $18");
    fireEvent.click(slot.getByRole("button", { name: "Пункт 1 не нужен" }));
    expect((await budgetButton(slot)).textContent).toContain("$5 · до $9");
  });

  it("риск в разбивке — тем же форматом, что у добавок: «–1r», итог «+2r»", async () => {
    const slot = open();
    fireEvent.click(await budgetButton(slot));
    const panel = within(slot.getByRole("group", { name: "Прогноз бюджета" }));
    expect(panel.getByText("–1r")).toBeTruthy();
    expect(panel.getByText("+2r")).toBeTruthy();
  });

  it("раскрывает разбивку с бюджетом и риском по строкам и свою цену, которая уходит в ответ", async () => {
    const slot = open();
    fireEvent.click(within(await slot.findByRole("group", { name: "Как?" })).getByRole("button", { name: /Виджет складывает/ }));
    fireEvent.click(await budgetButton(slot));
    const panel = within(slot.getByRole("group", { name: "Прогноз бюджета" }));
    expect(panel.getByText("Итого")).toBeTruthy();
    expect(panel.getAllByRole("row").length).toBeGreaterThanOrEqual(4);
    fireEvent.change(panel.getByRole("textbox", { name: "Своя цель" }), { target: { value: "$25" } });
    fireEvent.change(panel.getByRole("textbox", { name: "Свой потолок" }), { target: { value: "$40" } });
    expect((await budgetButton(slot)).textContent).toContain("$25 · до $40");
    fireEvent.click(slot.getByRole("button", { name: "Отправить бриф" }));
    await vi.waitFor(() => expect(slot.rpcCalls.some((c) => c.method === "answerBrief")).toBe(true));
    const call = slot.rpcCalls.find((c) => c.method === "answerBrief")?.input as { answer: { budget?: unknown } };
    expect(call.answer.budget).toEqual({ target: "$25", max: "$40" });
  });
});

describe("добавки пунктов и вариантов частями", () => {
  it("у пункта и варианта мелко написаны деньги и риск отдельными частями", async () => {
    const slot = open();
    const criteria = within(await slot.findByRole("group", { name: "Готово, когда" }));
    expect(criteria.getByText("+$5–9")).toBeTruthy();
    expect(criteria.getByText("+3r")).toBeTruthy();
    expect(criteria.getByText("–1r")).toBeTruthy();
    const how = within(slot.getByRole("group", { name: "Как?" }));
    expect(how.getByText("+$1–2")).toBeTruthy();
  });
});
