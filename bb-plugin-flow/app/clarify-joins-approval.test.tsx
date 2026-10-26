// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const T = "2026-10-25T10:00:00.000Z";
const stages = { list: [builtinStage("approve", [])], minButtonWidth: 160 };
const fork = (id: string) => ({ id, kind: "fork" as const, question: `Вопрос ${id}?`, allowOwn: false, options: [{ id: "a", action: "Первый", description: "Так.", recommended: false }, { id: "b", action: "Второй", description: "Иначе.", recommended: false }] });
const clarify: DecisionBrief = { id: "dec_c", threadId: "thr_1", title: "Уточнение", createdAt: T, kind: "clarify", settle: "approval", questions: [fork("one"), fork("two")] };
const quick: DecisionBrief = {
  id: "dec_y",
  threadId: "thr_1",
  title: "Тон",
  createdAt: T,
  kind: "clarify",
  settle: "approval",
  questions: [{ id: "tone", kind: "yesno", question: "Завести тон?", allowOwn: false, options: [{ id: "yes", action: "Да", recommended: true }, { id: "no", action: "Нет", recommended: false }] }],
};
const approval: DecisionBrief = {
  id: "dec_a",
  threadId: "thr_1",
  title: "Утверждение",
  createdAt: T,
  kind: "brief",
  questions: [],
  stages,
  outcome: { stage: "approve", final: false, next: "Дальше", done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] },
};

const accepted = (input: { answer: DecisionAnswer }) => ({ kind: "accepted" as const, record: { answer: input.answer, messageId: "msg_1", answeredAt: T } });

const open = (brief: DecisionBrief, rpc: Record<string, unknown> = {}) =>
  renderSlot<PluginMessageDirectiveProps, never>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief, answer: null }),
        answerBrief: accepted,
        approvalMembers: () => ({ members: [clarify] }),
        getDispatchPlace: () => ({ place: "here" }),
        listProjects: () => ({ kind: "found" as const, projects: [] }),
        ...({ threadFiles } as object),
        ...rpc,
      } as never,
    },
  );

describe("уточнение над открытым Утверждением", () => {
  it("уточнение из нескольких вопросов — без своей кнопки и без «Исполнять»: ответ уйдёт с Утверждением", async () => {
    const slot = open(clarify);
    expect(await slot.findByText("Уйдёт агенту с Утверждением — агент пока работает дальше")).toBeTruthy();
    expect(slot.queryByRole("button", { name: /Отправить/ })).toBeNull();
    expect(slot.queryByText("Исполнять")).toBeNull();
  });

  it("вариант уточнения из одного вопроса только отмечается: ответ сам не уходит", async () => {
    const answerBrief = vi.fn(accepted);
    const slot = open(quick, { answerBrief });
    fireEvent.click(await slot.findByRole("button", { name: /Нет/ }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(answerBrief).not.toHaveBeenCalled();
  });

  it("уточнение без ответа не держит «Продолжить»", async () => {
    const slot = open(approval);
    const button = (await slot.findByRole("button", { name: "Продолжить" })) as HTMLButtonElement;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(button.disabled).toBe(false);
    expect(slot.queryByText(/Ответьте на вопросы в виджетах выше/)).toBeNull();
  });
});
