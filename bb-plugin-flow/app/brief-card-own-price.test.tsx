// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const add = (target: number, max: number, risk: number, minutes: number) => ({ target, max, risk, minutes });

const brief: DecisionBrief = {
  id: "dec_own_price",
  threadId: "thr_1",
  title: "Своя цена карандашом",
  createdAt: "2026-10-05T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  scope: "Цена $5 и маска «$» в тексте",
  setup: { criteria: [{ text: "Кнопка бюджета", add: add(7, 13, 1, 40) }] },
  questions: [],
};

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "not_found" }) } },
  );

type Slot = ReturnType<typeof open>;
const totalRow = async (slot: Slot) => (await slot.findByRole("group", { name: "Этапы и бюджет" })).querySelector<HTMLElement>("[data-total]")!;
const field = (row: HTMLElement, name: string) => within(row).getByRole<HTMLInputElement>("textbox", { name });

describe("своя цена карандашом в «Итого»", () => {
  it("строки «Своя цена» нет; карандаш в «Итого» превращает время, цель и потолок в поля с числами итога", async () => {
    const slot = open();
    const row = await totalRow(slot);
    expect(within(await slot.findByRole("group", { name: "Этапы и бюджет" })).queryByText("Своя цена")).toBeNull();
    expect(within(row).queryByRole("textbox")).toBeNull();
    fireEvent.click(within(row).getByRole("button", { name: "Править цену" }));
    expect(field(row, "Своё время").value).toBe("40");
    expect(field(row, "Своя цель").value).toBe("7");
    expect(field(row, "Свой потолок").value).toBe("13");
  });

  it("маска не пускает лишние символы; набранное уходит в ответ своей ценой, нетронутое — нет", async () => {
    const slot = open();
    const row = await totalRow(slot);
    fireEvent.click(within(row).getByRole("button", { name: "Править цену" }));
    fireEvent.change(field(row, "Своё время"), { target: { value: "1 ч 20" } });
    fireEvent.change(field(row, "Своя цель"), { target: { value: "$25.555" } });
    expect(field(row, "Своё время").value).toBe("120");
    expect(field(row, "Своя цель").value).toBe("25.55");
    fireEvent.click(within(row).getByRole("button", { name: "Принять цену" }));
    expect(within(row).queryByRole("textbox")).toBeNull();
    expect(row.textContent).toContain("120 мин");
    expect(row.textContent).toContain("$25.55–$13");
    fireEvent.click(slot.getByRole("button", { name: "Отправить бриф" }));
    await vi.waitFor(() => expect(slot.rpcCalls.some((c) => c.method === "answerBrief")).toBe(true));
    const call = slot.rpcCalls.find((c) => c.method === "answerBrief")?.input as { answer: { budget?: unknown } };
    expect(call.answer.budget).toEqual({ minutes: "120", target: "25.55" });
  });

  it("Enter закрывает правку с набранным, Esc возвращает числа, какие были до карандаша", async () => {
    const slot = open();
    const row = await totalRow(slot);
    fireEvent.click(within(row).getByRole("button", { name: "Править цену" }));
    fireEvent.change(field(row, "Свой потолок"), { target: { value: "40" } });
    fireEvent.keyDown(field(row, "Свой потолок"), { key: "Enter" });
    expect(within(row).queryByRole("textbox")).toBeNull();
    expect(row.textContent).toContain("$7–$40");
    fireEvent.click(within(row).getByRole("button", { name: "Править цену" }));
    expect(field(row, "Свой потолок").value).toBe("40");
    fireEvent.change(field(row, "Свой потолок"), { target: { value: "90" } });
    fireEvent.change(field(row, "Своя цель"), { target: { value: "30" } });
    fireEvent.keyDown(field(row, "Своя цель"), { key: "Escape" });
    expect(within(row).queryByRole("textbox")).toBeNull();
    expect(row.textContent).toContain("$7–$40");
  });
});

describe("клавиши правки цены", () => {
  it("Esc на галочке, куда остался фокус после карандаша, возвращает прежние числа", async () => {
    const slot = open();
    const row = await totalRow(slot);
    fireEvent.click(within(row).getByRole("button", { name: "Править цену" }));
    fireEvent.change(field(row, "Своя цель"), { target: { value: "30" } });
    fireEvent.keyDown(within(row).getByRole("button", { name: "Принять цену" }), { key: "Escape" });
    expect(within(row).queryByRole("textbox")).toBeNull();
    expect(row.textContent).toContain("$7–$13");
  });
});

describe("плагины формул в ленте", () => {
  it("карточка брифа стоит внутри samp — его плагины формул вроде bb-better-latex обходят, «$» в тексте не верстается формулой", async () => {
    const slot = open();
    const table = await slot.findByRole("group", { name: "Этапы и бюджет" });
    expect(table.closest("samp")).not.toBeNull();
  });
});
