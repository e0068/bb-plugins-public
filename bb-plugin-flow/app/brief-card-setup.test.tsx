// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SETUP_ROW } from "../core/rows";
import type { AnswerRecord, DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const add = (target: number, max: number, risk: number, minutes?: number) => ({ target, max, risk, ...(minutes === undefined ? {} : { minutes }) });

const brief: DecisionBrief = {
  id: "dec_setup",
  threadId: "thr_1",
  title: "Нижний блок",
  createdAt: "2026-09-14T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  planning: { minutes: 42 },
  setup: {
    artifacts: [
      { id: "task", name: "Задача", state: "missing", recommended: true, add: add(1, 2, 0) },
      { id: "prototype", name: "HTML-прототип", state: "missing", recommended: false },
      { id: "spec", name: "Спецификация", state: "missing", recommended: true, add: add(5, 10, -2, 30) },
      { id: "plan", name: "План", state: "missing", recommended: false },
    ],
    executor: { recommended: "self", adds: { subagents: add(3, 5, 1, -20) } },
    checker: { recommended: "agent", adds: { self: add(1, 2, 1, 5) }, models: [{ name: "Fable 5.1", recommended: true, add: add(3, 5, -2, 15) }] },
    testing: { recommended: "none", adds: { self: add(1, 3, -1, 20) } },
    criteria: [{ text: "Кнопка", add: add(5, 9, 2) }],
  },
  questions: [],
};

const open = (answer: AnswerRecord | null = null) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer }), answerBrief: () => ({ kind: "not_found" }) } },
  );

type Slot = ReturnType<typeof open>;
const block = async (slot: Slot) => within(await slot.findByRole("group", { name: "Ответ на бриф" }));
const valueOf = (cell: HTMLElement): HTMLElement => cell.querySelector("[data-cell-value]") as HTMLElement;
const dim = (cell: HTMLElement) => valueOf(cell).className.includes("text-muted-foreground");
const bright = (cell: HTMLElement) => valueOf(cell).className.includes("text-foreground") && !dim(cell);
const artifact = (slot: Slot, id: string) => slot.container.querySelector(`[data-artifact="${id}"]`) as HTMLElement;

describe("ячейки нижнего блока", () => {
  it("в ячейках нижнего блока нет звёздочки, в раскрытом списке есть", async () => {
    const slot = open();
    const b = await block(slot);
    const cells = [b.getByRole("button", { name: /^Исполняет/ }), b.getByRole("button", { name: /^Ревью/ }), b.getByRole("button", { name: /^Бюджет/ }), artifact(slot, "spec")];
    for (const cell of cells) {
      expect(cell.textContent).not.toContain("✦");
      expect(within(cell).queryByText("рекомендация агента")).toBeNull();
    }
    fireEvent.click(b.getByRole("button", { name: /^Ревью/ }));
    expect(within(b.getByRole("group", { name: "Ревью" })).getByRole("button", { name: /Сторонний агент на Fable 5\.1/ }).textContent).toContain("✦");
  });

  it("нетронутое значение тусклое", async () => {
    const slot = open();
    const b = await block(slot);
    for (const name of [/^Исполняет/, /^Ревью/, /^Тестирование/, /^Бюджет/]) expect(dim(b.getByRole("button", { name }))).toBe(true);
    expect(dim(artifact(slot, "spec"))).toBe(true);
  });

  it("выбранное владельцем значение контрастное, даже совпадая с рекомендацией", async () => {
    const slot = open();
    const b = await block(slot);
    fireEvent.click(b.getByRole("button", { name: /^Исполняет/ }));
    fireEvent.click(within(b.getByRole("group", { name: "Исполняет" })).getByRole("button", { name: /Сам$/ }));
    expect(bright(b.getByRole("button", { name: /^Исполняет/ }))).toBe(true);
    expect(dim(b.getByRole("button", { name: /^Ревью/ }))).toBe(true);
    fireEvent.click(within(artifact(slot, "plan")).getByRole("button", { name: /^План/ }));
    expect(bright(artifact(slot, "plan"))).toBe(true);
    expect(dim(artifact(slot, "spec"))).toBe(true);
  });

  it("своя цена делает бюджет контрастным", async () => {
    const slot = open();
    const b = await block(slot);
    fireEvent.click(b.getByRole("button", { name: /^Бюджет/ }));
    fireEvent.change(b.getByRole("textbox", { name: "Своя цель" }), { target: { value: "$20" } });
    expect(bright(b.getByRole("button", { name: /^Бюджет/ }))).toBe(true);
  });

  it("после Ревью стоит кнопка Тестирование", async () => {
    const b = await block(open());
    const names = b.getAllByRole("button", { name: /^(Исполняет|Ревью|Тестирование|Бюджет|Приоритет)/ }).map((el) => el.querySelector("span > span")?.textContent);
    expect(names).toEqual(["Исполняет", "Ревью", "Тестирование", "Бюджет"]);
  });
});

describe("разница с базой и разбивка", () => {
  it("вариант списка показывает разницу деньгами, риском и временем", async () => {
    const b = await block(open());
    fireEvent.click(b.getByRole("button", { name: /^Исполняет/ }));
    const list = within(b.getByRole("group", { name: "Исполняет" }));
    expect(list.getByRole("button", { name: /^Субагенты/ }).textContent).toContain("+$3–5+1r–20 мин");
    fireEvent.click(b.getByRole("button", { name: /^Тестирование/ }));
    const testing = within(b.getByRole("group", { name: "Тестирование" }));
    expect(testing.getAllByRole("button").map((el) => el.textContent?.replace("✦", "").replace("рекомендация агента", ""))[0]).toBe("Нет");
  });

  it("плюс риска красный, минус зелёный", async () => {
    const slot = open();
    const b = await block(slot);
    fireEvent.click(b.getByRole("button", { name: /^Ревью/ }));
    const list = within(b.getByRole("group", { name: "Ревью" }));
    expect(list.getByText("+1r").className).toContain("text-destructive");
    expect(list.getByText("–2r").className).toContain("text-success");
    expect(list.getByText("+$1–2").className).toContain("text-muted-foreground");
  });

  it("колонки разбивки — время, риск, цель, потолок", async () => {
    const b = await block(open());
    fireEvent.click(b.getByRole("button", { name: /^Бюджет/ }));
    const panel = within(b.getByRole("group", { name: "Прогноз бюджета" }));
    expect(panel.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["строка", "время", "риск", "цель", "потолок"]);
    const target = panel.getByRole("textbox", { name: "Своя цель" });
    const max = panel.getByRole("textbox", { name: "Свой потолок" });
    const ownRow = target.closest("tr")!;
    expect(max.closest("tr")).toBe(ownRow);
    const cells = within(ownRow).getAllByRole("cell");
    expect([cells.findIndex((c) => c.contains(target)), cells.findIndex((c) => c.contains(max))]).toEqual([3, 4]);
  });

  it("в отвеченном брифе контрастно только расхождение с рекомендацией", async () => {
    const record: AnswerRecord = {
      messageId: "msg_1",
      answeredAt: "2026-09-14T10:00:00.000Z",
      answer: {
        briefId: brief.id,
        answers: [
          { questionId: SETUP_ROW.artifacts, optionIds: ["task", "spec"] },
          { questionId: SETUP_ROW.executor, optionIds: ["subagents"] },
          { questionId: SETUP_ROW.checker, optionIds: ["agent:Fable 5.1"] },
          { questionId: SETUP_ROW.testing, optionIds: ["none"] },
        ],
        criteria: { removed: [], edited: [], added: [] },
      },
    };
    const slot = open(record);
    const b = await block(slot);
    const cell = (label: string) => b.getAllByText(label, { selector: "span" })[0]!.closest("div, button") as HTMLElement;
    expect(bright(cell("Исполняет"))).toBe(true);
    expect(dim(cell("Ревью"))).toBe(true);
    expect(dim(cell("Тестирование"))).toBe(true);
  });
});
