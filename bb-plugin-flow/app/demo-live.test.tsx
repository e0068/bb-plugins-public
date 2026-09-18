// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionAnswer, DecisionBrief, decisionsRpcContract, dispatchRpcContract, outcomeRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const demo: DecisionBrief = {
  id: "dec_live",
  threadId: "thr_1",
  title: "Демонстрация починки",
  createdAt: "2026-09-17T10:00:00.000Z",
  kind: "brief",
  launched: true,
  questions: [],
  outcome: {
    stage: "demo",
    final: false,
    next: "Ревью",
    done: ["Баг починен"],
    pending: [],
    results: [
      { label: "страница", target: "http://localhost:5173/" },
      { label: "Приложение", command: "open -a Calculator" },
    ],
  },
  stages: { list: [{ ...builtinStage("demo", []), name: "Демонстрация" }], minButtonWidth: 160 },
};

const legacy: DecisionBrief = {
  id: "dec_legacy",
  threadId: "thr_1",
  title: "Бриф старого вида",
  createdAt: "2026-09-17T10:00:00.000Z",
  kind: "brief",
  questions: [
    { id: "artifacts", kind: "toggles", question: "Артефакты", allowOwn: false, options: [{ id: "task", action: "Задача", recommended: true }] },
    { id: "priority", kind: "choice", question: "Приоритет", allowOwn: false, options: [{ id: "speed", action: "Скорость", recommended: true }, { id: "price", action: "Цена", recommended: false }] },
  ],
};

type Rpc = typeof decisionsRpcContract & typeof dispatchRpcContract & typeof outcomeRpcContract;

const open = (brief: DecisionBrief, handlers: { answerBrief?: (input: { answer: DecisionAnswer }) => unknown; runOutcomeCommand?: (input: { briefId: string; index: number }) => unknown } = {}) =>
  renderSlot<PluginMessageDirectiveProps, Rpc>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief, answer: null }),
        answerBrief: (handlers.answerBrief ?? (() => ({ kind: "not_found" }))) as never,
        getDispatchPlace: () => ({ place: "here" }),
        runOutcomeCommand: (handlers.runOutcomeCommand ?? (() => ({ kind: "sent", created: false }))) as never,
      },
    },
  );

describe("результаты Демонстрации — живые", () => {
  it("одно нажатие запускает команду: RPC с id брифа и индексом результата", async () => {
    const run = vi.fn(() => ({ kind: "sent" as const, created: false }));
    const slot = open(demo, { runOutcomeCommand: run });
    const card = within(await slot.findByRole("group", { name: "Демонстрация" }));
    fireEvent.click(card.getByRole("button", { name: "Выполнить в терминале" }));
    await vi.waitFor(() => expect(run).toHaveBeenCalledWith({ briefId: "dec_live", index: 1 }));
    expect(await slot.findByText("Отправлено в терминал треда")).toBeTruthy();
  });

  it("итог с отметкой documentsOnly говорит, что живой ссылки нет — сделаны только документы", async () => {
    const slot = open({ ...demo, outcome: { ...demo.outcome!, results: [{ label: "spec.md", target: "memory/specs/spec.md" }], documentsOnly: true } });
    const card = within(await slot.findByRole("group", { name: "Демонстрация" }));
    expect(card.getByText("Только документы — живой ссылки нет")).toBeTruthy();
  });
});

describe("«Исполнять» слева от любой отправки", () => {
  it("у Демонстрации «Исполнять» стоит перед «Продолжить», и выбор нового треда уходит в ответе", async () => {
    const answers: DecisionAnswer[] = [];
    const slot = open(demo, {
      answerBrief: ({ answer }) => {
        answers.push(answer);
        return { kind: "accepted", record: { answer, messageId: "msg_1", answeredAt: "2026-09-17T10:05:00.000Z" } };
      },
    });
    const place = await slot.findByRole("button", { name: /^Исполнять/ });
    const go = slot.getByRole("button", { name: "Продолжить" });
    expect(place.compareDocumentPosition(go) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(place);
    fireEvent.click(within(slot.getByRole("group", { name: "Тред" })).getByRole("button", { name: /В новом треде/ }));
    fireEvent.click(go);
    await vi.waitFor(() => expect(answers[0]?.place).toBe("thread"));
  });

  it("у брифа старого вида «Исполнять» стоит перед «Отправить»", async () => {
    const slot = open(legacy);
    const place = await slot.findByRole("button", { name: /^Исполнять/ });
    const send = slot.getByRole("button", { name: "Отправить бриф" });
    expect(place.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
