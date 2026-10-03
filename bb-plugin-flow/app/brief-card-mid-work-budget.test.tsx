// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

/** Бриф со скриншота владельца: прогон утверждён за $35–63 и 175 мин при объёме $7–12.6 — доллар объёма стоит прогону пять. */
const priced: DecisionBrief = {
  id: "dec_mid_budget",
  threadId: "thr_1",
  title: "Уведомление о новых записях",
  createdAt: "2026-10-03T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  launched: true,
  approvedBudget: { minutes: 175, target: 35, max: 63 },
  approvedScope: { target: 7, max: 12.6, risk: 2, minutes: 35 },
  questions: [
    {
      id: "channel",
      kind: "fork",
      allowOwn: false,
      question: "Через какой канал?",
      options: [
        { id: "feed", action: "Лента на витрине", description: "…", recommended: true, add: { target: 2, max: 3, risk: 1, minutes: 12 } },
        { id: "push", action: "Ретранслятор", description: "…", recommended: false, add: { target: 4, max: 6, risk: 2, minutes: 20 } },
      ],
    },
  ],
};

const free: DecisionBrief = {
  ...priced,
  id: "dec_mid_free",
  questions: [{ id: "ok", kind: "confirm", allowOwn: false, question: "Правильно понял?", options: [{ id: "yes", action: "Да", recommended: true }] }],
};

const open = (brief: DecisionBrief) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "not_found" }) } },
  );

describe("ячейка «Бюджет» в брифе посреди работы", () => {
  it("показывает утверждённый бюджет и итог с выбранным вариантом", async () => {
    const slot = open(priced);
    fireEvent.click(within(await slot.findByRole("group", { name: "Через какой канал?" })).getByRole("button", { name: /Лента на витрине/ }));
    const budget = slot.getByRole("button", { name: /^Бюджет/ });
    expect(budget.textContent).toContain("$35–63 → $45–78");
    expect(budget.textContent).toContain("235 мин");
  });

  it("выбор другого варианта сразу меняет итог", async () => {
    const slot = open(priced);
    fireEvent.click(within(await slot.findByRole("group", { name: "Через какой канал?" })).getByRole("button", { name: /Ретранслятор/ }));
    expect(slot.getByRole("button", { name: /^Бюджет/ }).textContent).toContain("$35–63 → $55–93");
  });

  it("разбивка — строка утверждённого при запуске и строка выбранного варианта с его ценой", async () => {
    const slot = open(priced);
    fireEvent.click(within(await slot.findByRole("group", { name: "Через какой канал?" })).getByRole("button", { name: /Лента на витрине/ }));
    fireEvent.click(slot.getByRole("button", { name: /^Бюджет/ }));
    const rows = within(slot.getByRole("group", { name: "Прогноз бюджета" })).getAllByRole("row").map((row) => row.textContent ?? "");
    expect(rows.find((row) => row.startsWith("Утверждено при запуске"))).toContain("$35$63");
    expect(rows.find((row) => row.startsWith("Вопрос 1"))).toContain("Лента на витрине");
    expect(rows.find((row) => row.startsWith("Вопрос 1"))).toContain("+$10+$15");
  });

  it("бриф без цен у вариантов показывает утверждённый бюджет без изменений", async () => {
    const slot = open(free);
    const budget = await slot.findByRole("button", { name: /^Бюджет/ });
    expect(budget.textContent).toContain("$35–63");
    expect(budget.textContent).not.toContain("→");
  });
});
