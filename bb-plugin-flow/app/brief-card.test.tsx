// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SETUP_ROW } from "../core/rows";
import type { AnswerRecord, DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const scale = (recommended: number, ...actions: string[]) => ({
  options: actions.map((action, i) => ({ id: `o${i}`, action, recommended: i === recommended })),
});

const brief: DecisionBrief = {
  id: "dec_setup",
  threadId: "thr_1",
  title: "CEL-115 — дерево",
  createdAt: "2026-09-13T00:00:00.000Z",
  kind: "brief",
  setup: {
    artifacts: [
      { id: "task", name: "Задача", state: "approved", recommended: false, link: { label: "SL-312", target: "docs/tasks/todo/sl-312.md" } },
      { id: "proto", name: "Прототип", state: "ready", recommended: false, link: { label: "prototype-312", target: "docs/assets/p.html" } },
      { id: "spec", name: "Спека", state: "stale", recommended: true },
      { id: "plan", name: "План", state: "missing", recommended: true },
    ],
    budgetTarget: scale(2, "—", "$15", "$30", "$45"),
    budgetMax: scale(2, "—", "$30", "$60", "$80"),
  },
  questions: [
    { id: "how", question: "Как устроена первая часть брифа?", context: "Инструкция не работает.", kind: "fork", allowOwn: false, options: [
      { id: "rows", action: "Фиксированные строки", recommended: true, description: "Схема не пустит вопрос.", cost: "~1M", risk: "XXL" },
      { id: "only", action: "Только артефакты", recommended: false, description: "Бюджеты уходят вниз.", cost: "~800k", risk: "M" },
    ] },
    { id: "edits", question: "Какие правки словаря внести?", kind: "pick", allowOwn: false, options: [
      { id: "row", action: "Строка дерева", recommended: true, description: "Вид строки." },
      { id: "depth", action: "Глубина", recommended: false, description: "Знаки вложенности.", cost: "~50k", risk: "XS" },
    ] },
    { id: "read", question: "Правильно ли я тебя понял?", context: "Первая часть без вопросов.", kind: "confirm", allowOwn: false, options: [
      { id: "yes", action: "Да", recommended: true },
    ] },
  ],
};

const answered: AnswerRecord = {
  answer: {
    briefId: brief.id,
    answers: [
      { questionId: SETUP_ROW.artifacts, optionIds: ["plan"] },
      { questionId: SETUP_ROW.budgetTarget, optionIds: ["o3"] },
      { questionId: SETUP_ROW.budgetMax, optionIds: [], own: "$100" },
      { questionId: "how", optionIds: ["only"] },
      { questionId: "edits", optionIds: ["row"], own: "И «Лист»" },
      { questionId: "read", optionIds: [], own: "Я ввёл свой ответ" },
    ],
  },
  messageId: "msg_1",
  answeredAt: "2026-09-13T10:00:00.000Z",
};

type Rpc = NonNullable<Parameters<typeof renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>>[2]>["rpc"];

const render = (rpc: Rpc, openWorkspaceFile: PluginMessageDirectiveProps["openWorkspaceFile"] = null) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    {
      attributes: { id: brief.id },
      source: `::decision{id="${brief.id}"}`,
      message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null },
      openWorkspaceFile,
    },
    { rpc },
  );

const open = (openFile: PluginMessageDirectiveProps["openWorkspaceFile"] = null) =>
  render({ getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "accepted", record: answered }) }, openFile);

const group = async (slot: ReturnType<typeof render>, name: string) => within(await slot.findByRole("group", { name }));
const pressedIn = (scope: ReturnType<typeof within>) =>
  scope.queryAllByRole("button").filter((b: HTMLElement) => b.getAttribute("aria-pressed") === "true").map((b: HTMLElement) => b.textContent);

describe("первая часть брифа", () => {
  it("ссылка артефакта открывает файл в просмотрщике bb", async () => {
    const openFile = vi.fn(() => true);
    const artifacts = await group(open(openFile), "Артефакты");
    fireEvent.click(artifacts.getByRole("button", { name: "SL-312" }));
    expect(openFile).toHaveBeenCalledWith("docs/tasks/todo/sl-312.md");
  });

  it("целевой и максимальный бюджет — две строки, у каждой своя цена", async () => {
    const slot = open();
    const target = await group(slot, "Целевой бюджет");
    const max = await group(slot, "Максимальный бюджет");
    fireEvent.click(target.getByRole("button", { name: /\$30/ }));
    expect(pressedIn(target)).toHaveLength(1);
    expect(pressedIn(target)[0]).toContain("$30");
    expect(pressedIn(max)).toEqual([]);
    fireEvent.change(target.getByRole("textbox", { name: "Своя цена" }), { target: { value: "$25" } });
    expect(pressedIn(target)).toEqual([]);
    expect(max.getByRole("textbox", { name: "Своя цена" })).toBeTruthy();
  });
});


/** Закрыть бриф кликами: строки первой части и вопросы — по первому варианту. */
const decideAll = async (slot: ReturnType<typeof render>) => {
  await slot.findByRole("button", { name: "Исполнять" });
  fireEvent.click((await group(slot, "Артефакты")).getByRole("button", { name: /^План/ }));
  for (const row of ["Целевой бюджет", "Максимальный бюджет"]) {
    const list = await group(slot, row);
    fireEvent.click(list.getAllByRole("button")[1]!);
  }
  for (const [question, option] of [["Как устроена первая часть брифа?", /Фиксированные строки/], ["Какие правки словаря внести?", /Строка дерева/], ["Правильно ли я тебя понял?", /Да/]] as const) {
    fireEvent.click(within(slot.getByRole("group", { name: question })).getByRole("button", { name: option }));
  }
};

describe("вторая часть брифа", () => {
  it("вопросы пронумерованы, полосы «Развилки» нет", async () => {
    const slot = open();
    expect(await slot.findByText("1. Как устроена первая часть брифа?")).toBeTruthy();
    expect(slot.getByText("3. Правильно ли я тебя понял?")).toBeTruthy();
    expect(slot.queryByText(/Развилки/)).toBeNull();
  });

  it("вариант показывает цену и уровень риска", async () => {
    const how = await group(open(), "Как устроена первая часть брифа?");
    const card = how.getByRole("button", { name: /Фиксированные строки/ });
    expect(card.textContent).toContain("Цена: ~1M");
    expect(card.textContent).toContain("Риск: XXL");
    expect(card.textContent).toContain("Схема не пустит вопрос.");
  });

  it("pick включает несколько и складывает свой ответ", async () => {
    const edits = await group(open(), "Какие правки словаря внести?");
    fireEvent.click(edits.getByRole("button", { name: /Строка дерева/ }));
    fireEvent.click(edits.getByRole("button", { name: /Глубина/ }));
    fireEvent.change(edits.getByRole("textbox", { name: "Свой ответ" }), { target: { value: "И «Лист»" } });
    expect(pressedIn(edits)).toHaveLength(2);
  });

  it("confirm — «Да» и свой ответ в одну строку, текст гасит «Да»", async () => {
    const read = await group(open(), "Правильно ли я тебя понял?");
    const yes = read.getByRole("button", { name: /Да/ });
    fireEvent.click(yes);
    expect(yes.getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(read.getByRole("textbox", { name: "Свой ответ" }), { target: { value: "Не совсем" } });
    expect(yes.getAttribute("aria-pressed")).toBe("false");
  });

  it("незакрытая строка первой части помечается по ответу incomplete", async () => {
    const slot = render({ getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "incomplete", questionIds: [SETUP_ROW.budgetMax] }) });
    await decideAll(slot);
    fireEvent.click(slot.getByRole("button", { name: "Отправить бриф" }));
    expect(await (await group(slot, "Максимальный бюджет")).findByText("нужен ответ")).toBeTruthy();
  });
});

describe("отвеченный бриф с первой частью", () => {
  const openAnswered = (openFile: PluginMessageDirectiveProps["openWorkspaceFile"] = null) =>
    render({ getBrief: () => ({ kind: "found", brief, answer: answered }), answerBrief: () => ({ kind: "not_found" }) }, openFile);

  it("рисуется без переключателей и полей, свои ответы видны текстом", async () => {
    const slot = openAnswered();
    await slot.findByText("Бриф отвечен");
    expect(slot.container.querySelectorAll("input, textarea, button[aria-pressed]")).toHaveLength(0);
    expect(slot.getByText("$100")).toBeTruthy();
    expect(slot.getByText("И «Лист»")).toBeTruthy();
    expect(slot.getByText("Я ввёл свой ответ")).toBeTruthy();
  });

  it("ссылки артефактов остаются кнопками", async () => {
    const openFile = vi.fn(() => true);
    const slot = openAnswered(openFile);
    await slot.findByText("Бриф отвечен");
    fireEvent.click(slot.getByRole("button", { name: "prototype-312" }));
    expect(openFile).toHaveBeenCalledWith("docs/assets/p.html");
  });
});

describe("полный ответ без приоритета", () => {
  it("закрытый кликами бриф отправляет строки первой части без приоритета", async () => {
    const slot = open();
    await decideAll(slot);
    expect(slot.queryByText(/заполнено/)).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Отправить бриф" }));
    await slot.findByText("Бриф отвечен");
    const call = slot.rpcCalls.find((c) => c.method === "answerBrief")?.input as { answer: { answers: Array<{ questionId: string }> } };
    expect(call.answer.answers.map((a) => a.questionId)).toEqual([SETUP_ROW.artifacts, SETUP_ROW.budgetTarget, SETUP_ROW.budgetMax, "how", "edits", "read"]);
  });
});
