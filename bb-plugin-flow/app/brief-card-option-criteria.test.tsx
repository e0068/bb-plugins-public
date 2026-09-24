// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnswerRecord, DecisionBrief, decisionsRpcContract } from "../shared/contract";

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

describe("строка пункта варианта в «Готово, когда»", () => {
  it("несёт только метку и текст пункта: название варианта остаётся в секции вопросов", async () => {
    const slot = open();
    const done = within(await slot.findByRole("group", { name: "Готово, когда" }));
    fireEvent.click(within(slot.getByRole("group", { name: "Документация?" })).getByRole("button", { name: /Сайт/ }));
    const row = done.getByText("Страница на сайте").closest("[data-item-row]");
    expect(row?.textContent).toBe("↳Страница на сайте");
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

describe("вариант, снятый владельцем, оставляет свои пункты зачёркнутыми", () => {
  const recommended: DecisionBrief = {
    ...brief,
    id: "dec_dropped",
    questions: [{ ...brief.questions[0]!, options: brief.questions[0]!.options.map((o) => (o.id === "readme" ? { ...o, recommended: true } : o)) }],
  };
  const openWith = (answer: AnswerRecord | null) =>
    renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
      app.messageDirectives[0]!,
      { attributes: { id: recommended.id }, source: `::decision{id="${recommended.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
      { rpc: { getBrief: () => ({ kind: "found", brief: recommended, answer }), answerBrief: () => ({ kind: "not_found" }) } as never },
    );

  it("ответ мимо рекомендации зачёркивает её пункт и оставляет целым пункт выбранного варианта", async () => {
    const slot = openWith(null);
    const done = within(await slot.findByRole("group", { name: "Готово, когда" }));
    expect(done.queryByText("README описывает витрину")).toBeNull();
    fireEvent.click(within(slot.getByRole("group", { name: "Документация?" })).getByRole("button", { name: /Сайт/ }));
    expect(done.getByText("README описывает витрину").className).toContain("line-through");
    expect(done.getByText("Страница на сайте").className).not.toContain("line-through");
  });

  it("владелец взял рекомендацию — её пункт цел, а чужие в списке не появляются", async () => {
    const slot = openWith(null);
    const done = within(await slot.findByRole("group", { name: "Готово, когда" }));
    fireEvent.click(within(slot.getByRole("group", { name: "Документация?" })).getByRole("button", { name: /README/ }));
    expect(done.getByText("README описывает витрину").className).not.toContain("line-through");
    expect(done.queryByText("Страница на сайте")).toBeNull();
  });

  it("смена выбора зачёркивает пункт прежнего варианта и распрямляет пункт нового", async () => {
    const slot = openWith(null);
    const done = within(await slot.findByRole("group", { name: "Готово, когда" }));
    const question = within(slot.getByRole("group", { name: "Документация?" }));
    fireEvent.click(question.getByRole("button", { name: /README/ }));
    expect(done.getByText("README описывает витрину").className).not.toContain("line-through");
    fireEvent.click(question.getByRole("button", { name: /Сайт/ }));
    expect(done.getByText("README описывает витрину").className).toContain("line-through");
    expect(done.getByText("Страница на сайте").className).not.toContain("line-through");
  });

  it("зачёркивание не сдвигает нумерацию пунктов брифа и не теряет правку владельца", async () => {
    const slot = openWith(null);
    const done = within(await slot.findByRole("group", { name: "Готово, когда" }));
    fireEvent.change(done.getByRole("textbox", { name: "Пункт 1" }), { target: { value: "Тесты зелёные и быстрые" } });
    fireEvent.click(within(slot.getByRole("group", { name: "Документация?" })).getByRole("button", { name: /Сайт/ }));
    expect(done.getByText("README описывает витрину").className).toContain("line-through");
    expect((done.getByRole("textbox", { name: "Пункт 1" }) as HTMLTextAreaElement).value).toBe("Тесты зелёные и быстрые");
    expect(done.queryByRole("textbox", { name: "Пункт 2" })).toBeNull();
  });

  it("отвеченная карточка показывает только живые пункты", async () => {
    const record: AnswerRecord = {
      answer: { briefId: recommended.id, answers: [{ questionId: "docs", optionIds: ["site"] }] },
      messageId: "msg_1",
      answeredAt: "2026-09-15T10:00:00.000Z",
    };
    const slot = openWith(record);
    const done = within(await slot.findByRole("group", { name: "Готово, когда" }));
    expect(done.getByText("Страница на сайте")).toBeTruthy();
    expect(done.queryByText("README описывает витрину")).toBeNull();
  });
});
