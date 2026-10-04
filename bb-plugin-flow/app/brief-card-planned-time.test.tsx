// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_planned",
  threadId: "thr_1",
  title: "Запланированное время",
  createdAt: "2026-09-15T00:00:00.000Z",
  kind: "brief",
  planning: { minutes: 42, cost: 4.2 },
  setup: { criteria: [{ text: "Кнопка", add: { target: 3, max: 5, risk: 1, minutes: 30 } }, { text: "Тесты", add: { target: 1, max: 2, risk: 0, minutes: 15 } }] },
  questions: [],
};

const open = (shown: DecisionBrief = brief) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: shown.id }, source: `::decision{id="${shown.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief: shown, answer: null }), answerBrief: () => ({ kind: "not_found" }) } },
  );

type Slot = ReturnType<typeof open>;
const table = (slot: Slot) => slot.findByRole("group", { name: "Этапы и бюджет" });

describe("время в таблице бюджета", () => {
  it("итог времени — запланированные минуты работы, а не потраченные на планирование", async () => {
    const total = (await table(open())).querySelector("[data-total]")!;
    expect(within(total as HTMLElement).getByText("45 мин")).toBeTruthy();
  });

  it("планирование — первой строкой с пометкой «уже потрачено»", async () => {
    const first = (await table(open())).querySelector<HTMLElement>("[data-line]")!;
    expect(first.textContent).toContain("Планирование в треде");
    expect(first.textContent).toContain("уже потрачено");
    expect(first.textContent).toContain("42 мин");
  });

  it("планирование без цены модели — минуты и прочерк вместо денег", async () => {
    const first = (await table(open({ ...brief, planning: { minutes: 42 } }))).querySelector<HTMLElement>("[data-line]")!;
    expect(first.textContent).toContain("42 мин");
    expect(within(first).getAllByText("—")).toHaveLength(2);
  });
});
