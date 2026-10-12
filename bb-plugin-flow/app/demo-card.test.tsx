// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { AnswerRecord, DecisionAnswer, DecisionBrief, decisionsRpcContract, dispatchRpcContract } from "../shared/contract";
import { threadFiles } from "./file-roots-fixture";

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
    results: [{ label: "prototype.html", target: "docs/assets/x/prototype.html" }, { label: "screenshots", target: "docs/assets/x/screenshots" }],
  },
  stages: { list: [{ ...builtinStage("demo", []), name: "Демонстрация" }], minButtonWidth: 160 },
};

const accepted = (input: { answer: DecisionAnswer }) => ({ kind: "accepted" as const, record: { answer: input.answer, messageId: "msg_1", answeredAt: "2026-09-16T10:05:00.000Z" } });

const open = (options: { patch?: Partial<DecisionBrief>; answerBrief?: typeof accepted; record?: AnswerRecord } = {}) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof dispatchRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief: { ...brief, ...options.patch }, answer: options.record ?? null }), answerBrief: options.answerBrief ?? accepted, getDispatchPlace: () => ({ place: "here" }), listProjects: () => ({ kind: "found" as const, projects: [] }), ...({ threadFiles } as object) } },
  );

type Slot = ReturnType<typeof open>;
const card = async (slot: Slot) => within(await slot.findByRole("group", { name: "Демонстрация" }));

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
    // Абзац — свой элемент: точное совпадение текста находит его, только если абзацы не слиты в один.
    expect(c.getByText("Сегменты обрезают подписи.").classList.contains("mde-body")).toBe(true);
    expect(c.getByText("Светлая тема проверена скриншотом.").classList.contains("mde-body")).toBe(true);
    expect(c.getByText("Как проверено")).toBeTruthy();
    expect(c.getByText("Тесты плагина зелёные.")).toBeTruthy();
  });

  it("каждый результат — своя строка, файл в ней — ссылка bb", async () => {
    const slot = open();
    const c = await card(slot);
    expect(slot.container.querySelectorAll("[data-result-row]")).toHaveLength(2);
    expect(await c.findByRole("link", { name: /^screenshots/ })).toBeTruthy();
  });

  it("под отчётом нет ни поля «Комментарий», ни кнопок; ни «Исполнять», ни бюджета, ни этапов", async () => {
    const slot = open();
    const wrap = await slot.findByRole("group", { name: "Демонстрация" });
    expect(slot.queryByRole("textbox")).toBeNull();
    expect(slot.queryByRole("button", { name: /Отправить|Продолжить|Завершить/ })).toBeNull();
    expect(within(wrap).queryByRole("textbox", { name: "Комментарий к утверждению" })).toBeNull();
    expect(slot.queryByRole("button", { name: /Исполнять/ })).toBeNull();
    expect(slot.queryByRole("button", { name: /Бюджет/ })).toBeNull();
    expect(slot.queryByRole("checkbox", { name: /в ближайший прогон/ })).toBeNull();
  });

  it("финальная Демонстрация — тоже только отчёт: кнопок нет вовсе", async () => {
    const { next: _next, ...interim } = brief.outcome!;
    const slot = open({ patch: { outcome: { ...interim, final: true } } });
    await card(slot);
    expect(slot.queryByRole("button", { name: /Отправить|Продолжить|Завершить/ })).toBeNull();
    expect(slot.queryByRole("textbox")).toBeNull();
  });

  it("сохранённая Демонстрация с рекомендованным flow и вопросами — отчёт: ни ряда перевода, ни вопросов", async () => {
    const slot = open({
      patch: {
        outcome: { ...brief.outcome!, nextFlow: "flow-bug" },
        questions: [{ id: "q", kind: "confirm", question: "Так?", allowOwn: false, options: [{ id: "yes", action: "Yes", recommended: false }] }],
      },
    });
    await card(slot);
    expect(slot.queryByRole("button", { name: /Flow|Модель|Исполнять|Отправить|Продолжить|Завершить/ })).toBeNull();
    expect(slot.queryByText("Так?")).toBeNull();
  });

  it("Ctrl+Enter на карточке Демонстрации ничего не отправляет", async () => {
    const answerBrief = vi.fn(accepted);
    const slot = open({ answerBrief });
    const wrap = await slot.findByRole("group", { name: "Демонстрация" });
    fireEvent.keyDown(wrap, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(wrap, { key: "Enter", metaKey: true });
    // Отправка зовёт сервер только после чтения вложений — проверка ждёт, пока этот путь успел бы дойти до вызова.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(answerBrief).not.toHaveBeenCalled();
  });

  it("Демонстрация с отправленным комментарием — строка исхода «Комментарий» и сам комментарий", async () => {
    const record: AnswerRecord = { messageId: "msg_1", answeredAt: "2026-09-16T10:05:00.000Z", answer: { briefId: brief.id, answers: [], outcome: { accepted: false, note: "Баннер ниже" } } };
    const slot = open({ record });
    const c = await card(slot);
    expect(c.queryByRole("textbox")).toBeNull();
    expect(slot.getByText("Комментарий", { selector: "b" })).toBeTruthy();
    expect(slot.getByText(/Баннер ниже/)).toBeTruthy();
  });
});
