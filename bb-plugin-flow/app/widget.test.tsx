// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import type { AnswerRecord, DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_brief",
  threadId: "thr_1",
  title: "Плагин Decisions — как вести работу",
  intro: "Задачи на доске нет, спецификации нет.",
  createdAt: "2026-09-12T12:00:00.000Z",
  kind: "brief",
  questions: [
    { id: "artifacts", kind: "toggles", question: "Артефакты", allowOwn: false, options: [
      { id: "task", action: "Задача", recommended: true },
      { id: "spec", action: "Спецификация", recommended: true },
      { id: "proto", action: "Прототип", recommended: false },
    ] },
    { id: "priority", kind: "choice", question: "Приоритет", context: "при конфликте", allowOwn: false, options: [
      { id: "speed", action: "Скорость", recommended: false },
      { id: "quality", action: "Качество", recommended: true },
      { id: "price", action: "Цена", recommended: false },
    ] },
    { id: "budget", kind: "choice", question: "Целевой бюджет", allowOwn: true, options: [
      { id: "low", action: "$8", recommended: false },
      { id: "mid", action: "$15", recommended: true },
      { id: "none", action: "Без цели", recommended: false },
    ] },
    { id: "executor", kind: "fork", question: "Кто исполняет работу?", allowOwn: false, options: [
      { id: "self", action: "Самостоятельно", recommended: true, description: "Пишу всё сам.", cost: "~1.5M токенов", risks: "приёмку ведёт автор" },
      { id: "pipeline", action: "Конвейер", recommended: false, description: "Три роли по очереди.", cost: "~2.5M токенов", risks: "въезд субагента" },
    ] },
    { id: "delivery", kind: "fork", question: "Как ответ попадает агенту?", allowOwn: false, options: [
      { id: "message", action: "Сообщением в тред", recommended: true, description: "Реплика в ленте.", cost: "~300k", risks: "агент забудет строку" },
      { id: "blocking", action: "Блокирующий инструмент", recommended: false, description: "Форма вместо композера.", cost: "~250k", risks: "таймаут" },
    ] },
  ],
};

const clarify: DecisionBrief = {
  id: "dec_clarify",
  threadId: "thr_1",
  title: "Журнал",
  createdAt: "2026-09-12T12:00:00.000Z",
  kind: "clarify",
  questions: [
    { id: "journal", kind: "yesno", question: "Журнал пишется только при ответе на бриф?", allowOwn: false, options: [
      { id: "yes", action: "Да", recommended: true },
      { id: "no", action: "Нет", recommended: false },
    ] },
  ],
};

const recordFor = (answers: AnswerRecord["answer"]["answers"], briefId = brief.id): AnswerRecord => ({
  answer: { briefId, answers },
  messageId: "msg_1",
  answeredAt: "2026-09-12T15:41:00.000Z",
});

const acceptedRecord = recordFor([
  { questionId: "artifacts", optionIds: ["task", "spec"] },
  { questionId: "priority", optionIds: ["speed"] },
  { questionId: "budget", optionIds: [], own: "$25" },
  { questionId: "executor", optionIds: ["pipeline"] },
  { questionId: "delivery", optionIds: ["message"] },
]);

const props = (id: string): PluginMessageDirectiveProps => ({
  attributes: { id },
  source: `::decision{id="${id}"}`,
  message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null },
  openWorkspaceFile: null,
});

type Rpc = Parameters<typeof renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>>[2];

const render = (id: string, rpc: NonNullable<Rpc>["rpc"]) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(app.messageDirectives[0]!, props(id), { rpc });

const openBrief = (answerBrief: NonNullable<NonNullable<Rpc>["rpc"]>["answerBrief"] = () => ({ kind: "accepted", record: acceptedRecord })) =>
  render(brief.id, { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief });

const group = async (slot: ReturnType<typeof render>, name: string) => within(await slot.findByRole("group", { name }));
const pressed = (el: HTMLElement) => el.getAttribute("aria-pressed");
const answerCalls = (slot: ReturnType<typeof render>) => slot.rpcCalls.filter((c) => c.method === "answerBrief");

describe("бриф в сообщении", () => {
  it("при первой отрисовке не выбрано ничего и счётчик показывает ноль", async () => {
    const slot = openBrief();
    await slot.findByText(brief.title);
    expect(slot.getAllByText("0 из 5 решено").length).toBeGreaterThan(0);
    const toggles = slot.container.querySelectorAll("[aria-pressed='true']");
    expect(toggles).toHaveLength(0);
  });

  it("принять рекомендации проставляет всё помеченное и доводит счётчик до полного", async () => {
    const slot = openBrief();
    fireEvent.click(await slot.findByRole("button", { name: "Принять рекомендации" }));
    expect(slot.getAllByText("5 из 5 решено").length).toBeGreaterThan(0);
    const artifacts = await group(slot, "Артефакты");
    expect(pressed(artifacts.getByRole("button", { name: /^Задача/ }))).toBe("true");
    expect(pressed(artifacts.getByRole("button", { name: /^Прототип/ }))).toBe("false");
    expect(pressed((await group(slot, "Кто исполняет работу?")).getByRole("button", { name: /^Самостоятельно/ }))).toBe("true");
  });

  it("choice и fork держат один выбор", async () => {
    const slot = openBrief();
    const priority = await group(slot, "Приоритет");
    fireEvent.click(priority.getByRole("button", { name: /^Скорость/ }));
    fireEvent.click(priority.getByRole("button", { name: /^Цена/ }));
    expect(priority.getAllByRole("button").filter((b) => pressed(b) === "true").map((b) => b.textContent)).toEqual(["Цена"]);
    const executor = await group(slot, "Кто исполняет работу?");
    fireEvent.click(executor.getByRole("button", { name: /^Самостоятельно/ }));
    fireEvent.click(executor.getByRole("button", { name: /^Конвейер/ }));
    expect(executor.getAllByRole("button").filter((b) => pressed(b) === "true")).toHaveLength(1);
  });

  it("toggles держат несколько", async () => {
    const slot = openBrief();
    const artifacts = await group(slot, "Артефакты");
    fireEvent.click(artifacts.getByRole("button", { name: /^Задача/ }));
    fireEvent.click(artifacts.getByRole("button", { name: /^Прототип/ }));
    expect(artifacts.getAllByRole("button").filter((b) => pressed(b) === "true")).toHaveLength(2);
  });

  it("ввод своего текста снимает выбор у развилки", async () => {
    const slot = openBrief();
    const executor = await group(slot, "Кто исполняет работу?");
    fireEvent.click(executor.getByRole("button", { name: /^Самостоятельно/ }));
    fireEvent.change(executor.getByRole("textbox", { name: "Ответить своё" }), { target: { value: "Вдвоём" } });
    expect(executor.getAllByRole("button").filter((b) => pressed(b) === "true")).toHaveLength(0);
  });

  it("выбор варианта развилки очищает поле своего", async () => {
    const slot = openBrief();
    const executor = await group(slot, "Кто исполняет работу?");
    const own = executor.getByRole("textbox", { name: "Ответить своё" }) as HTMLInputElement;
    fireEvent.change(own, { target: { value: "Вдвоём" } });
    fireEvent.click(executor.getByRole("button", { name: /^Конвейер/ }));
    expect(own.value).toBe("");
  });

  it("ввод в поле бюджета снимает выбор сегмента", async () => {
    const slot = openBrief();
    const budget = await group(slot, "Целевой бюджет");
    fireEvent.click(budget.getByRole("button", { name: /^\$15/ }));
    fireEvent.change(budget.getByRole("textbox", { name: "Своё значение" }), { target: { value: "$25" } });
    expect(pressed(budget.getByRole("button", { name: /^\$15/ }))).toBe("false");
  });

  it("строка toggles без включённых решена после касания", async () => {
    const slot = openBrief();
    const artifacts = await group(slot, "Артефакты");
    const task = artifacts.getByRole("button", { name: /^Задача/ });
    fireEvent.click(task);
    fireEvent.click(task);
    expect(slot.getAllByText("1 из 5 решено").length).toBeGreaterThan(0);
  });

  it("кнопка отправки заблокирована, пока решены не все", async () => {
    const slot = openBrief();
    const send = (await slot.findByRole("button", { name: "Отправить бриф" })) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(within((await slot.findByRole("group", { name: "Приоритет" }))).getByRole("button", { name: /^Скорость/ }));
    expect(send.disabled).toBe(true);
    fireEvent.click(slot.getByRole("button", { name: "Принять рекомендации" }));
    expect(send.disabled).toBe(false);
  });

  it("отправка зовёт answerBrief один раз и передаёт ответы всех вопросов", async () => {
    const slot = openBrief();
    fireEvent.click(await slot.findByRole("button", { name: "Принять рекомендации" }));
    const send = slot.getByRole("button", { name: "Отправить бриф" });
    fireEvent.click(send);
    fireEvent.click(send);
    await slot.findByText("Бриф отвечен");
    expect(answerCalls(slot)).toHaveLength(1);
    const input = answerCalls(slot)[0]?.input as { id: string; messageId: string; answer: { answers: unknown[] } };
    expect(input.id).toBe(brief.id);
    expect(input.messageId).toBe("msg_1");
    expect(input.answer.answers).toHaveLength(5);
  });

  it("ответ incomplete подсвечивает названные вопросы", async () => {
    const slot = openBrief(() => ({ kind: "incomplete", questionIds: ["priority"] }));
    fireEvent.click(await slot.findByRole("button", { name: "Принять рекомендации" }));
    fireEvent.click(slot.getByRole("button", { name: "Отправить бриф" }));
    const priority = await group(slot, "Приоритет");
    expect(await priority.findByText("нужен ответ")).toBeTruthy();
    expect((await group(slot, "Артефакты")).queryByText("нужен ответ")).toBeNull();
  });

  it("отвеченный бриф рисуется без кнопок и полей", async () => {
    const slot = render(brief.id, { getBrief: () => ({ kind: "found", brief, answer: acceptedRecord }), answerBrief: () => ({ kind: "not_found" }) });
    await slot.findByText("Бриф отвечен");
    expect(slot.container.querySelectorAll("button, input, textarea")).toHaveLength(0);
    expect(slot.getByText("$25")).toBeTruthy();
    expect(slot.getAllByText(/Рекомендовал/).length).toBeGreaterThan(0);
  });

  it("отвеченный бриф помечает рекомендованный вариант компактного вопроса", async () => {
    const slot = render(brief.id, { getBrief: () => ({ kind: "found", brief, answer: acceptedRecord }), answerBrief: () => ({ kind: "not_found" }) });
    await slot.findByText("Бриф отвечен");
    const quality = slot.getByText("Качество");
    expect(within(quality).getByText("рекомендация агента")).toBeTruthy();
    expect(within(slot.getByText("Скорость")).queryByText("рекомендация агента")).toBeNull();
  });

  it("сбой отправки просит попробовать ещё раз и оставляет черновик", async () => {
    const slot = openBrief(() => {
      throw new Error("сервер недоступен");
    });
    fireEvent.click(await slot.findByRole("button", { name: "Принять рекомендации" }));
    fireEvent.click(slot.getByRole("button", { name: "Отправить бриф" }));
    expect(await slot.findByText("Не удалось отправить — попробуй ещё раз")).toBeTruthy();
    expect(pressed((await group(slot, "Приоритет")).getByRole("button", { name: /^Качество/ }))).toBe("true");
    expect((slot.getByRole("button", { name: "Отправить бриф" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("событие decisions:answered с этим идентификатором перерисовывает бриф в отвеченный", async () => {
    let answer: AnswerRecord | null = null;
    const slot = render(brief.id, { getBrief: () => ({ kind: "found", brief, answer }), answerBrief: () => ({ kind: "not_found" }) });
    await slot.findByRole("button", { name: "Принять рекомендации" });
    answer = acceptedRecord;
    await slot.emitRealtime("decisions:answered", { id: "dec_other" });
    expect(slot.queryByText("Бриф отвечен")).toBeNull();
    await slot.emitRealtime("decisions:answered", { id: brief.id });
    await slot.findByText("Бриф отвечен");
  });

  it("рекомендованный вариант несёт скрытую подпись рекомендация агента", async () => {
    const slot = openBrief();
    const artifacts = await group(slot, "Артефакты");
    const hint = within(artifacts.getByRole("button", { name: /^Задача/ })).getByText("рекомендация агента");
    expect(hint.className).toContain("sr-only");
    expect(within(artifacts.getByRole("button", { name: /^Прототип/ })).queryByText("рекомендация агента")).toBeNull();
  });

  it("после отправки контролы уходят из обхода Tab", async () => {
    const slot = openBrief();
    fireEvent.click(await slot.findByRole("button", { name: "Принять рекомендации" }));
    fireEvent.click(slot.getByRole("button", { name: "Отправить бриф" }));
    await slot.findByText("Бриф отвечен");
    const focusable = slot.container.querySelectorAll("button, input, textarea, [tabindex]:not([tabindex='-1'])");
    expect(focusable).toHaveLength(0);
  });

  it("длинный текст варианта рисуется целиком", async () => {
    const long = "Очень длинное описание варианта. ".repeat(400);
    const withLong: DecisionBrief = {
      ...brief,
      questions: brief.questions.map((q) => (q.id === "executor" ? { ...q, options: q.options.map((o, i) => (i === 0 ? { ...o, description: long } : o)) } : q)),
    };
    const slot = render(brief.id, { getBrief: () => ({ kind: "found", brief: withLong, answer: null }), answerBrief: () => ({ kind: "not_found" }) });
    const executor = await group(slot, "Кто исполняет работу?");
    expect(executor.getByRole("button", { name: /^Самостоятельно/ }).textContent).toContain(long.trim());
  });
});

describe("уточнение в сообщении", () => {
  const openClarify = () =>
    render(clarify.id, {
      getBrief: () => ({ kind: "found", brief: clarify, answer: null }),
      answerBrief: ({ answer }) => ({ kind: "accepted", record: { answer, messageId: "msg_1", answeredAt: "2026-09-12T15:41:00.000Z" } }),
    });

  it("clarify рисуется одной строкой без кнопки отправки и отвечает сразу по нажатию Да", async () => {
    const slot = openClarify();
    await slot.findByText("можно не отвечать");
    expect(slot.queryByRole("button", { name: /Отправить/ })).toBeNull();
    expect(slot.queryByRole("button", { name: "Принять рекомендации" })).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: /^Да/ }));
    await waitFor(() => expect(answerCalls(slot)).toHaveLength(1));
    expect(answerCalls(slot)[0]?.input).toMatchObject({ answer: { answers: [{ questionId: "journal", optionIds: ["yes"] }] } });
  });

  it("Enter в поле уточнения отправляет свой текст", async () => {
    const slot = openClarify();
    const field = await slot.findByRole("textbox", { name: "или ответь своими словами" });
    fireEvent.change(field, { target: { value: "Только при ответе, и ещё при правке" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(answerCalls(slot)).toHaveLength(1));
    expect(answerCalls(slot)[0]?.input).toMatchObject({
      answer: { answers: [{ questionId: "journal", optionIds: [], own: "Только при ответе, и ещё при правке" }] },
    });
  });
});

describe("директива без брифа", () => {
  it("бриф не найден рисуется пунктирной рамкой с исходным текстом директивы", async () => {
    const slot = render("dec_gone", { getBrief: () => ({ kind: "not_found" }), answerBrief: () => ({ kind: "not_found" }) });
    expect(await slot.findByText('::decision{id="dec_gone"}')).toBeTruthy();
    expect(slot.getByText(/бриф не найден/)).toBeTruthy();
  });

  it("кривой идентификатор не рушит сообщение и не зовёт RPC", async () => {
    const slot = render("не-бриф", { getBrief: () => ({ kind: "not_found" }), answerBrief: () => ({ kind: "not_found" }) });
    expect(await slot.findByText('::decision{id="не-бриф"}')).toBeTruthy();
    expect(slot.rpcCalls).toHaveLength(0);
  });

  it("ошибка RPC показывает кнопку повторить", async () => {
    let fail = true;
    const slot = render(brief.id, {
      getBrief: () => {
        if (fail) throw new Error("сервер недоступен");
        return { kind: "found", brief, answer: null };
      },
      answerBrief: () => ({ kind: "not_found" }),
    });
    expect(await slot.findByText("Не удалось загрузить бриф")).toBeTruthy();
    fail = false;
    fireEvent.click(slot.getByRole("button", { name: "Повторить" }));
    expect(await slot.findByText(brief.title)).toBeTruthy();
  });
});
