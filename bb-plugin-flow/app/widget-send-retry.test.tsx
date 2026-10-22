// @vitest-environment jsdom
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SEND_RETRY_DELAYS_MS } from "../core/send-failure";
import type { AnswerRecord, DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const brief: DecisionBrief = {
  id: "dec_retry",
  threadId: "thr_1",
  title: "Повтор отправки",
  createdAt: "2026-10-21T16:43:00.000Z",
  kind: "brief",
  questions: [
    { id: "pick", kind: "fork", question: "Что делать?", allowOwn: false, options: [
      { id: "a", action: "Первое", recommended: true, description: "Первый путь.", add: { target: 0, max: 0, risk: 0 } },
      { id: "b", action: "Второе", recommended: false, description: "Второй путь.", add: { target: 1, max: 2, risk: 0 } },
    ] },
  ],
};

const record: AnswerRecord = { answer: { briefId: brief.id, answers: [{ questionId: "pick", optionIds: ["a"] }] }, messageId: "msg_1", answeredAt: "2026-10-21T16:44:00.000Z" };

type Rpc = Parameters<typeof renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>>[2];

const open = (answerBrief: NonNullable<NonNullable<Rpc>["rpc"]>["answerBrief"]) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: null },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief } },
  );

const submit = async (slot: ReturnType<typeof open>) => {
  fireEvent.click(within(await slot.findByRole("group", { name: "Что делать?" })).getByRole("button", { name: /Первое/ }));
  fireEvent.click(slot.getByRole("button", { name: /^Отправить/ }));
};
const answerCalls = (slot: ReturnType<typeof open>) => slot.rpcCalls.filter((c) => c.method === "answerBrief").length;
const waitAll = () => act(() => vi.advanceTimersByTimeAsync(SEND_RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0) + 1_000));

describe("отправка брифа при сбое связи с bb", () => {
  it("обрыв связи на первой попытке не виден владельцу: отправка повторяется сама и проходит", async () => {
    let attempts = 0;
    const slot = open(() => {
      attempts += 1;
      if (attempts < 3) throw new TypeError("Load failed");
      return { kind: "accepted", record };
    });
    await submit(slot);
    await waitAll();
    expect(answerCalls(slot)).toBe(3);
    expect(slot.queryByText(/Не удалось отправить/)).toBeNull();
    expect(await slot.findByText("Ответ отправлен")).toBeTruthy();
  });

  it("bb не ответил ни на один повтор — под кнопкой причина, а не только «попробуй ещё раз»", async () => {
    const slot = open(() => {
      throw Object.assign(new Error("Timed out waiting for command result"), { code: "command_timeout" });
    });
    await submit(slot);
    await waitAll();
    expect(answerCalls(slot)).toBe(SEND_RETRY_DELAYS_MS.length + 1);
    expect(slot.getAllByText(/Не удалось отправить/).length).toBeGreaterThan(0);
    expect(slot.getByText(/bb не ответил/)).toBeTruthy();
  });

  it("нет связи ни на одном повторе — причина «нет связи с bb»", async () => {
    const slot = open(() => {
      throw new TypeError("Failed to fetch");
    });
    await submit(slot);
    await waitAll();
    expect(slot.getByText(/нет связи с bb/)).toBeTruthy();
  });

  it("отказ bb не повторяется и показан его словами", async () => {
    const slot = open(() => {
      throw new Error("the provider differs from the thread's");
    });
    await submit(slot);
    await waitAll();
    expect(answerCalls(slot)).toBe(1);
    expect(slot.getByText(/the provider differs from the thread's/)).toBeTruthy();
  });
});

describe("окно повторов отправки брифа", () => {
  it("попытка, которую bb держал до своего таймаута, не повторяется: причина видна через полминуты, а не через минуты", async () => {
    const slot = open(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      throw Object.assign(new Error("Timed out waiting for command result"), { code: "command_timeout" });
    });
    await submit(slot);
    await act(() => vi.advanceTimersByTimeAsync(31_000));
    expect(answerCalls(slot)).toBe(1);
    expect(slot.getByText(/bb не ответил/)).toBeTruthy();
  });
});
