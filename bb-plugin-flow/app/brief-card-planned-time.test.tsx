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

describe("время в кнопке бюджета", () => {
  it("второй строкой — запланированные минуты работы, а не потраченные на планирование", async () => {
    const button = within(await open().findByRole("button", { name: /^Бюджет/ }));
    expect(button.getByText("45 мин")).toBeTruthy();
    expect(button.queryByText("42 мин, $4.2")).toBeNull();
  });

  it("в разбивке планирование подписано уже потраченным, итог времени — запланированное", async () => {
    const slot = open();
    fireEvent.click(await slot.findByRole("button", { name: /^Бюджет/ }));
    const rows = within(slot.getByRole("group", { name: "Прогноз бюджета" })).getAllByRole("row");
    expect(rows[1]?.textContent).toContain("уже потрачено");
    expect(rows.at(-2)?.textContent).toContain("Итого");
    expect(rows.at(-2)?.textContent).toContain("45 мин");
  });

  it("планирование без цены модели — минуты и прочерк вместо денег", async () => {
    const slot = open({ ...brief, planning: { minutes: 42 } });
    fireEvent.click(await slot.findByRole("button", { name: /^Бюджет/ }));
    const first = within(slot.getByRole("group", { name: "Прогноз бюджета" })).getAllByRole("row")[1]!;
    expect(within(first).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Планирование в треде · уже потрачено", "42 мин", "", "—", "—"]);
  });
});
