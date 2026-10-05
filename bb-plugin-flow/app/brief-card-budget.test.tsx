// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
const table = async (slot: Slot) => within(await slot.findByRole("group", { name: "Этапы и бюджет" }));
const total = async (slot: Slot) => (await slot.findByRole("group", { name: "Этапы и бюджет" })).querySelector("[data-total]")!.textContent;

describe("бюджет таблицей", () => {
  it("строка «Итого» — цель и потолок через тире; пересчитывается при снятии пункта и выборе", async () => {
    const slot = open();
    expect(await total(slot)).toContain("$7–$13");
    fireEvent.click(within(slot.getByRole("group", { name: "Как?" })).getByRole("button", { name: /Виджет складывает/ }));
    expect(await total(slot)).toContain("$10–$18");
    fireEvent.click(slot.getByRole("button", { name: "Пункт 1 не нужен" }));
    expect(await total(slot)).toContain("$5–$9");
  });

  it("подписи колонок сверху; риск строк — «–1r», итоговый — «+2r»", async () => {
    const slot = open();
    const rows = await table(slot);
    for (const head of ["Риск", "Время", "Цель", "Потолок"]) expect(rows.getByText(head)).toBeTruthy();
    expect(rows.getByText("–1r")).toBeTruthy();
    expect(within((await slot.findByRole("group", { name: "Этапы и бюджет" })).querySelector<HTMLElement>("[data-total]")!).getByText("+2r")).toBeTruthy();
  });
});

describe("добавки пунктов и вариантов частями", () => {
  it("у пункта и варианта мелко написаны деньги и риск отдельными частями", async () => {
    const slot = open();
    const criteria = within(await slot.findByRole("group", { name: "Definition of Done" }));
    expect(criteria.getByText("+$5–9")).toBeTruthy();
    expect(criteria.getByText("+3r")).toBeTruthy();
    expect(criteria.getByText("–1r")).toBeTruthy();
    const how = within(slot.getByRole("group", { name: "Как?" }));
    expect(how.getByText("+$1–2")).toBeTruthy();
  });
});
