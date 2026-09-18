// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { AnswerRecord, DecisionAnswer, DecisionBrief, decisionsRpcContract, dispatchRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_demo",
  threadId: "thr_1",
  title: "Демонстрация прототипа",
  intro: "Подзаголовок агента",
  createdAt: "2026-09-16T10:00:00.000Z",
  kind: "brief",
  revocable: true,
  launched: true,
  questions: [],
  outcome: {
    stage: "demo",
    final: false,
    next: "Спецификация",
    done: ["Место исполнения слева от «Отправить»", "Счётчик на кнопке"],
    pending: [{ text: "Итог этапа — одна секция", why: "делаю следующим шагом" }],
    notes: "Сегменты обрезают подписи.\n\nСветлая тема проверена скриншотом.",
    sections: [{ title: "Как проверено", text: "Тесты плагина зелёные." }],
    tasks: [{ key: "BBPL-1", done: true }],
    results: [{ label: "prototype.html", target: "memory/assets/x/prototype.html" }, { label: "screenshots", target: "memory/assets/x/screenshots" }],
  },
  stages: { list: [{ ...builtinStage("demo", []), name: "Демонстрация" }], minButtonWidth: 160 },
};

const accepted = (input: { answer: DecisionAnswer }) => ({ kind: "accepted" as const, record: { answer: input.answer, messageId: "msg_1", answeredAt: "2026-09-16T10:05:00.000Z" } });

const open = (options: { patch?: Partial<DecisionBrief>; answerBrief?: typeof accepted; record?: AnswerRecord } = {}) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof dispatchRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief: { ...brief, ...options.patch }, answer: options.record ?? null }), answerBrief: options.answerBrief ?? accepted, getDispatchPlace: () => ({ place: "here" }) } },
  );

type Slot = ReturnType<typeof open>;
const card = async (slot: Slot) => within(await slot.findByRole("group", { name: "Демонстрация" }));
const comment = (slot: Slot, text: string) => fireEvent.change(slot.getByRole("textbox", { name: "Комментарий к демонстрации" }), { target: { value: text } });
const sentOutcome = async (fn: ReturnType<typeof vi.fn>) => {
  await vi.waitFor(() => expect(fn).toHaveBeenCalled());
  return (fn.mock.calls[0]![0] as { answer: DecisionAnswer }).answer.outcome;
};

describe("карточка Демонстрации", () => {
  it("бирка вида и следующий этап; заголовка и подзаголовка агента на экране нет", async () => {
    const slot = open();
    const c = await card(slot);
    expect(c.getByText("Демонстрация")).toBeTruthy();
    expect(c.getByText(/дальше Спецификация/)).toBeTruthy();
    expect(slot.queryByText("Демонстрация прототипа")).toBeNull();
    expect(slot.queryByText("Подзаголовок агента")).toBeNull();
  });

  it("«Сделано» пунктами с галочками, «Не сделано» с причиной", async () => {
    const c = await card(open());
    const done = c.getByText("Место исполнения слева от «Отправить»").closest("[data-demo-item]")!;
    expect(done.querySelector('[data-icon="Check"]')).not.toBeNull();
    expect(c.getByText(/делаю следующим шагом/)).toBeTruthy();
  });

  it("«Важно знать» и секции — отдельными абзацами", async () => {
    const c = await card(open());
    expect(c.getByText("Сегменты обрезают подписи.").tagName).toBe("P");
    expect(c.getByText("Светлая тема проверена скриншотом.").tagName).toBe("P");
    expect(c.getByText("Как проверено")).toBeTruthy();
    expect(c.getByText("Тесты плагина зелёные.").tagName).toBe("P");
  });

  it("результаты — отдельными строками, задачи — ключами", async () => {
    const slot = open();
    const c = await card(slot);
    expect(slot.container.querySelectorAll("[data-result-row]")).toHaveLength(2);
    expect(c.getByRole("button", { name: /^screenshots/ })).toBeTruthy();
    expect(c.getByText("BBPL-1")).toBeTruthy();
  });

  it("поле комментария прикреплено к карточке, кнопки — вне её, бюджета и этапов нет", async () => {
    const slot = open();
    const wrap = await slot.findByRole("group", { name: "Демонстрация" });
    expect(within(wrap).getByRole("textbox", { name: "Комментарий к демонстрации" })).toBeTruthy();
    expect(within(wrap).queryByRole("button", { name: /Продолжить|Исполнять/ })).toBeNull();
    expect(slot.getByRole("button", { name: "Продолжить" })).toBeTruthy();
    expect(slot.queryByRole("button", { name: /Бюджет|в ближайший прогон/ })).toBeNull();
  });

  it("пустой комментарий — одна кнопка «Продолжить», она отправляет продолжение", async () => {
    const answerBrief = vi.fn(accepted);
    const slot = open({ answerBrief });
    await card(slot);
    expect(slot.queryByRole("button", { name: "На доработку" })).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Продолжить" }));
    expect(await sentOutcome(answerBrief)).toEqual({ accepted: true });
  });

  it("у финальной Демонстрации кнопка — «Завершить»", async () => {
    const { next: _next, ...interim } = brief.outcome!;
    const slot = open({ patch: { outcome: { ...interim, final: true } } });
    await card(slot);
    expect(slot.getByRole("button", { name: "Завершить" })).toBeTruthy();
  });

  it("написанный комментарий — «Учесть и продолжить» уходит принятым с комментарием", async () => {
    const answerBrief = vi.fn(accepted);
    const slot = open({ answerBrief });
    await card(slot);
    comment(slot, "Подпись короче");
    expect(slot.queryByRole("button", { name: "Продолжить" })).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Учесть и продолжить" }));
    expect(await sentOutcome(answerBrief)).toEqual({ accepted: true, note: "Подпись короче" });
  });

  it("написанный комментарий — «На доработку» уходит непринятым", async () => {
    const answerBrief = vi.fn(accepted);
    const slot = open({ answerBrief });
    await card(slot);
    comment(slot, "Баннер ниже");
    fireEvent.click(slot.getByRole("button", { name: "На доработку" }));
    expect(await sentOutcome(answerBrief)).toEqual({ accepted: false, note: "Баннер ниже" });
  });

  it("отвеченная Демонстрация — та же карточка без поля и строка исхода с комментарием", async () => {
    const record: AnswerRecord = { messageId: "msg_1", answeredAt: "2026-09-16T10:05:00.000Z", answer: { briefId: brief.id, answers: [], outcome: { accepted: false, note: "Баннер ниже" } } };
    const slot = open({ record });
    const c = await card(slot);
    expect(c.queryByRole("textbox")).toBeNull();
    expect(slot.getByText(/На доработку/)).toBeTruthy();
    expect(slot.getByText(/Баннер ниже/)).toBeTruthy();
  });
});
