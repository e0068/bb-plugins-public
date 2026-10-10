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
  id: "dec_approve",
  threadId: "thr_1",
  title: "Утверждение Definition of Done",
  intro: "Подзаголовок агента",
  createdAt: "2026-09-16T10:00:00.000Z",
  kind: "brief",
  revocable: true,
  launched: true,
  questions: [],
  outcome: {
    stage: "approve",
    final: false,
    next: "Спецификация",
    done: ["Место исполнения слева от «Отправить»", "Счётчик на кнопке"],
    pending: [{ text: "Итог этапа — одна секция", why: "делаю следующим шагом" }],
    notes: "Сегменты обрезают подписи.\n\nСветлая тема проверена скриншотом.",
    sections: [{ title: "Как проверено", text: "Тесты плагина зелёные." }],
    tasks: [{ key: "BBPL-1", done: true }],
    results: [{ label: "prototype.html", target: "docs/assets/x/prototype.html" }, { label: "screenshots", target: "docs/assets/x/screenshots" }],
  },
  stages: { list: [builtinStage("approve", [])], minButtonWidth: 160 },
};

const accepted = (input: { answer: DecisionAnswer }) => ({ kind: "accepted" as const, record: { answer: input.answer, messageId: "msg_1", answeredAt: "2026-09-16T10:05:00.000Z" } });

const open = (options: { patch?: Partial<DecisionBrief>; answerBrief?: typeof accepted; record?: AnswerRecord } = {}) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract & typeof dispatchRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief: { ...brief, ...options.patch }, answer: options.record ?? null }), answerBrief: options.answerBrief ?? accepted, getDispatchPlace: () => ({ place: "here" }), listProjects: () => ({ kind: "found" as const, projects: [] }), ...({ threadFiles } as object) } },
  );

type Slot = ReturnType<typeof open>;
const card = async (slot: Slot) => within(await slot.findByRole("group", { name: "Утверждение" }));
const comment = (slot: Slot, text: string) => fireEvent.change(slot.getByRole("textbox", { name: "Комментарий к демонстрации" }), { target: { value: text } });
const sentOutcome = async (fn: ReturnType<typeof vi.fn>) => {
  await vi.waitFor(() => expect(fn).toHaveBeenCalled());
  return (fn.mock.calls[0]![0] as { answer: DecisionAnswer }).answer.outcome;
};

describe("виджет Утверждения", () => {
  it("бирка «Утверждение», пустой комментарий — кнопка «Утвердить», она утверждает", async () => {
    const answerBrief = vi.fn(accepted);
    const slot = open({ answerBrief });
    const c = await card(slot);
    expect(c.getByText("Утверждение")).toBeTruthy();
    expect(slot.queryByRole("button", { name: "Продолжить" })).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Утвердить" }));
    expect(await sentOutcome(answerBrief)).toEqual({ accepted: true });
  });

  it("написанный комментарий — «Отправить» вместо «Утвердить», уходит неутверждённым", async () => {
    const answerBrief = vi.fn(accepted);
    const slot = open({ answerBrief });
    await card(slot);
    comment(slot, "Пункты длинные");
    expect(slot.queryByRole("button", { name: "Утвердить" })).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Отправить" }));
    expect(await sentOutcome(answerBrief)).toEqual({ accepted: false, note: "Пункты длинные" });
  });

  it("утверждённое — строка исхода «Утверждено»", async () => {
    const record: AnswerRecord = { messageId: "msg_1", answeredAt: "2026-10-10T10:05:00.000Z", answer: { briefId: brief.id, answers: [], outcome: { accepted: true } } };
    const slot = open({ record });
    await card(slot);
    expect(slot.getByText("Утверждено", { selector: "b" })).toBeTruthy();
  });
});
