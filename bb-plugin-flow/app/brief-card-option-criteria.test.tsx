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
  id: "dec_option_criteria",
  threadId: "thr_1",
  title: "Пункты у вариантов",
  createdAt: "2026-09-15T00:00:00.000Z",
  kind: "brief",
  setup: { criteria: ["Тесты зелёные"] },
  questions: [
    { id: "docs", question: "Документация?", kind: "fork", allowOwn: false, options: [
      { id: "readme", action: "README", recommended: false, description: "…", criteria: ["README описывает витрину"], add: { target: 0, max: 0, risk: 0 } },
      { id: "site", action: "Сайт", recommended: false, description: "…", criteria: ["Страница на сайте"], add: { target: 1, max: 2, risk: 0 } },
      { id: "look", action: "Сначала посмотреть", recommended: false, description: "…", removes: [0], add: { target: 0, max: 0, risk: 0 } },
    ] },
  ],
};

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "not_found" }) } },
  );

describe("пункты варианта в «Готово, когда»", () => {
  it("выбор варианта добавляет его пункты в список, смена выбора убирает их", async () => {
    const slot = open();
    const done = within(await slot.findByRole("group", { name: "Готово, когда" }));
    expect(done.queryByText("README описывает витрину")).toBeNull();
    const question = within(slot.getByRole("group", { name: "Документация?" }));
    fireEvent.click(question.getByRole("button", { name: /README/ }));
    expect(done.getByText("README описывает витрину")).toBeTruthy();
    fireEvent.click(question.getByRole("button", { name: /Сайт/ }));
    expect(done.queryByText("README описывает витрину")).toBeNull();
    expect(done.getByText("Страница на сайте")).toBeTruthy();
  });

  it("вариант, снимающий пункты, зачёркивает их сам, а смена выбора возвращает", async () => {
    const slot = open();
    const done = within(await slot.findByRole("group", { name: "Готово, когда" }));
    const question = within(slot.getByRole("group", { name: "Документация?" }));
    fireEvent.click(question.getByRole("button", { name: /Сначала посмотреть/ }));
    expect(done.queryByRole("button", { name: "Пункт 1 не нужен" })).toBeNull();
    expect(done.queryByRole("button", { name: "Вернуть пункт 1" })).toBeNull();
    expect(done.getByText("Тесты зелёные").className).toContain("line-through");
    fireEvent.click(question.getByRole("button", { name: /Сайт/ }));
    expect(done.getByRole("button", { name: "Пункт 1 не нужен" })).toBeTruthy();
  });
});

describe("список «Готово, когда» только из пунктов вариантов", () => {
  const { setup: _setup, ...withoutSetup } = brief;
  const bare: DecisionBrief = { ...withoutSetup, id: "dec_bare", questions: brief.questions.map((q) => ({ ...q, options: q.options.map(({ removes: _removes, ...o }) => o) })) };
  const openBare = () =>
    renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
      app.messageDirectives[0]!,
      { attributes: { id: bare.id }, source: `::decision{id="${bare.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
      { rpc: { getBrief: () => ({ kind: "found", brief: bare, answer: null }), answerBrief: () => ({ kind: "not_found" }) } },
    );

  it("без пунктов брифа поля «Дополнить» нет: такой пункт агенту не уйдёт", async () => {
    const slot = openBare();
    fireEvent.click(within(await slot.findByRole("group", { name: "Документация?" })).getByRole("button", { name: /README/ }));
    const done = within(slot.getByRole("group", { name: "Готово, когда" }));
    expect(done.getByText("README описывает витрину")).toBeTruthy();
    expect(done.queryByRole("textbox", { name: "Дополнить" })).toBeNull();
  });
});

describe("заголовок «Готово, когда» в брифе с этапами", () => {
  const staged: DecisionBrief = {
    ...brief,
    id: "dec_staged_criteria",
    stages: { list: [{ id: "implement", skill: "code", name: "Реализация", review: false, executors: [] }], minButtonWidth: 170 },
    setup: { stages: [{ id: "implement", state: "todo", recommended: true, executor: "self", add: { target: 10, max: 20, risk: 1 } }], criteria: [{ text: "Тесты зелёные", add: { target: 5, max: 9, risk: 1 } }] },
  };
  const openStaged = () =>
    renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
      app.messageDirectives[0]!,
      { attributes: { id: staged.id }, source: `::decision{id="${staged.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
      { rpc: { getBrief: () => ({ kind: "found", brief: staged, answer: null }), answerBrief: () => ({ kind: "not_found" }) } },
    );

  it("сумма долей пунктов не выглядит добавкой к бюджету", async () => {
    const slot = openStaged();
    const done = await slot.findByRole("group", { name: "Готово, когда" });
    expect(done.firstElementChild?.textContent).not.toContain("+$5–9");
  });
});
