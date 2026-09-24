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

const brief: DecisionBrief = {
  id: "dec_answered",
  threadId: "thr_1",
  title: "Память выбора",
  createdAt: "2026-09-14T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  planning: { minutes: 12, cost: 1.4 },
  setup: {
    artifacts: [
      { id: "task", name: "Задача", state: "approved", recommended: false, link: { label: "SL-1", target: "docs/tasks/todo/sl-1.md" } },
      { id: "prototype", name: "HTML-прототип", state: "ready", recommended: true, link: { label: "decisions-pamyat-vybora-vladelca-prototype.html", target: "docs/assets/decisions-pamyat-vybora-vladelca-prototype.html" } },
      { id: "spec", name: "Спецификация", state: "missing", recommended: true, add: { target: 2, max: 4, risk: -2 } },
      { id: "plan", name: "План", state: "missing", recommended: false },
    ],
    executor: { recommended: "subagents", adds: { subagents: { target: 4, max: 8, risk: 1 } } },
    checker: { recommended: "agent", models: [{ name: "Opus 5", recommended: true }] },
    testing: { recommended: "self" },
  },
  questions: [],
};

const render = (target: DecisionBrief, answer: AnswerRecord | null) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: target.id }, source: `::decision{id="${target.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief: target, answer }), answerBrief: () => ({ kind: "not_found" }) } as never },
  );

type Slot = ReturnType<typeof render>;
const block = async (slot: Slot) => within(await slot.findByRole("group", { name: "Ответ на бриф" }));

const recordOf = (answers: AnswerRecord["answer"]["answers"], forecast?: AnswerRecord["forecast"]): AnswerRecord => ({
  answer: { briefId: brief.id, answers },
  ...(forecast === undefined ? {} : { forecast }),
  messageId: "msg_1",
  answeredAt: "2026-09-14T10:00:00.000Z",
});

const answers = (picked: boolean): AnswerRecord["answer"]["answers"] => [
  { questionId: SETUP_ROW.artifacts, optionIds: ["task", "prototype", "spec"] },
  { questionId: SETUP_ROW.executor, optionIds: ["workflow"], ...(picked ? { picked: ["workflow"] } : {}) },
  { questionId: SETUP_ROW.checker, optionIds: ["none"] },
  { questionId: SETUP_ROW.testing, optionIds: ["self"] },
];

const valueClass = (group: ReturnType<typeof within>, text: string): string => group.getByText(text).closest("[data-cell-value]")!.className;

const snapshot: NonNullable<AnswerRecord["forecast"]> = {
  lines: [{ label: "Снимок на отправке", note: "строка", minutes: 30, risk: 1, target: 16, max: 32 }],
  minutes: 30,
  risk: 1,
  target: 17,
  max: 33,
};

describe("отвеченный бриф", () => {
  it("отвеченный бриф красит контрастным выбранное владельцем, а не расхождение", async () => {
    const group = await block(render(brief, recordOf(answers(true))));
    expect(valueClass(group, "Workflow")).toContain("text-foreground");
    expect(valueClass(group, "Нет")).toContain("text-muted-foreground");
  });

  it("старый ответ без меток красит по расхождению", async () => {
    const group = await block(render(brief, recordOf(answers(false))));
    expect(valueClass(group, "Нет")).toContain("text-foreground");
    expect(valueClass(group, "Сам")).toContain("text-muted-foreground");
  });

  it("кнопка бюджета отвеченного брифа показывает снимок, а не пересчёт", async () => {
    const group = await block(render(brief, recordOf(answers(true), snapshot)));
    expect(group.getByRole("button", { name: /^Бюджет/ }).textContent).toContain("$17 · до $33");
  });

  it("отвеченный бриф раскрывает разбивку снимка без полей своей цены", async () => {
    const slot = render(brief, recordOf(answers(true), snapshot));
    const group = await block(slot);
    fireEvent.click(group.getByRole("button", { name: /^Бюджет/ }));
    const panel = within(group.getByRole("group", { name: "Прогноз бюджета" }));
    expect(panel.getByText("Снимок на отправке")).toBeTruthy();
    expect(panel.queryByRole("textbox", { name: "Своя цель" })).toBeNull();
    expect(panel.queryByText("Своя цена")).toBeNull();
  });
});

describe("новый бриф с переносом", () => {
  it("перенесённое значение в новом брифе тусклое, ✦ в списке у рекомендации агента", async () => {
    const carried: DecisionBrief = { ...brief, id: "dec_carried", carried: { [SETUP_ROW.checker]: ["none"] } };
    const group = await block(render(carried, null));
    const button = group.getByRole("button", { name: /^Ревью/ });
    expect(button.querySelector("[data-cell-value]")!.textContent).toBe("Нет");
    expect(button.querySelector("[data-cell-value]")!.className).toContain("text-muted-foreground");
    fireEvent.click(button);
    const panel = within(group.getByRole("group", { name: "Ревью" }));
    expect(panel.getByText("рекомендация агента").closest("button")!.textContent).toContain("Opus 5");
    expect(panel.getByRole("button", { pressed: true }).textContent).toContain("Нет");
  });

  it("имя документа — ссылка с многоточием и иконкой перехода справа", async () => {
    const slot = render(brief, null);
    await block(slot);
    const cell = slot.container.querySelector<HTMLElement>('[data-artifact="prototype"]')!;
    const link = within(cell).getByRole("button", { name: /decisions-pamyat-vybora-vladelca-prototype\.html/ });
    const [name, icon] = Array.from(link.children);
    expect(name!.textContent).toBe("decisions-pamyat-vybora-vladelca-prototype.html");
    expect(name!.className).toContain("truncate");
    expect(icon!.tagName.toLowerCase()).toBe("svg");
    expect(icon!.getAttribute("class")).toContain("shrink-0");
  });
});
