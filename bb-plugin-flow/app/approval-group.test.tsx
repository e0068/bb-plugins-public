// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import { messages } from "../lib/messages";
import type { ChecklistItem, DecisionAnswer, DecisionBrief } from "../shared/contract";
import { approveLabel, memberAnswer, memberEdits, settledInitial } from "./approval-edits";
import { pickOption, setNote } from "./draft";
import { storeDraft } from "./draft-storage";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const T = "2026-10-13T10:00:00.000Z";
const stages = { list: [builtinStage("questions", []), builtinStage("demo", []), builtinStage("approve", [])], minButtonWidth: 160 };
const fork = { id: "go", kind: "fork" as const, question: "Как делаем?", allowOwn: false, options: [{ id: "a", action: "Просто", description: "Одним файлом.", recommended: true }, { id: "b", action: "Сложно", description: "Тремя слоями.", recommended: false }] };
const questions: DecisionBrief = { id: "dec_q", threadId: "thr_1", title: "Вопросы", createdAt: T, kind: "brief", settle: "approval", questions: [fork] };
const result = { label: "a.md", target: "a.md" };
const outcome = (stage: string) => ({ stage, final: false, next: "Дальше", done: ["Сделано"], pending: [], results: [result] });
const demo: DecisionBrief = { id: "dec_d", threadId: "thr_1", title: "Демонстрация", createdAt: T, kind: "brief", questions: [], stages, settle: "approval", outcome: outcome("demo") };
const approval: DecisionBrief = { id: "dec_a", threadId: "thr_1", title: "Утверждение", createdAt: T, kind: "brief", questions: [], stages, outcome: outcome("approve") };

const t = messages("ru").outcome;

describe("правки виджетов группы и подпись кнопки Утверждения", () => {
  it("нетронутый виджет правок не даёт; ответ не по рекомендации и комментарий — по правке", () => {
    const draft = settledInitial(questions);
    expect(memberEdits(questions, draft)).toBe(0);
    expect(memberEdits(questions, setNote(pickOption(draft, fork, "b", questions), "без лишних файлов"))).toBe(2);
    expect(memberEdits(demo, setNote(settledInitial(demo), "проверь тему"))).toBe(1);
  });

  it("с Утверждением уходит ответ брифа из черновика, у Демонстрации — только комментарий", () => {
    expect(memberAnswer(questions, settledInitial(questions))).toEqual({ id: "dec_q", answer: { briefId: "dec_q", answers: [{ questionId: "go", optionIds: ["a"] }] } });
    expect(memberAnswer(demo, setNote(settledInitial(demo), " тема "))).toEqual({ id: "dec_d", note: "тема" });
    expect(memberAnswer(demo, settledInitial(demo))).toEqual({ id: "dec_d" });
  });

  it("комментарий — на доработку, правки — «с правками · N», иначе — «Продолжить», финальное — «Завершить», flow — «Отправить»", () => {
    const base = { moves: false, commented: false, edits: 0, finishes: false };
    expect(approveLabel({ ...base, commented: true, edits: 3 }, t)).toBe("Отправить комментарии");
    expect(approveLabel({ ...base, edits: 3 }, t)).toBe("Продолжить с правками · 3");
    expect(approveLabel(base, t)).toBe("Продолжить");
    expect(approveLabel({ ...base, finishes: true }, t)).toBe("Завершить");
    expect(approveLabel({ ...base, moves: true, commented: true }, t)).toBe("Отправить");
  });
});

const accepted = (input: { answer: DecisionAnswer }) => ({ kind: "accepted" as const, record: { answer: input.answer, messageId: "msg_1", answeredAt: T } });

const open = (brief: DecisionBrief, rpc: Record<string, unknown> = {}, extra: { checklist?: ChecklistItem[]; answered?: boolean; sentWith?: string } = {}) =>
  renderSlot<PluginMessageDirectiveProps, never>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    {
      rpc: {
        getBrief: () => ({
          kind: "found",
          brief,
          answer: extra.answered === true ? { answer: { briefId: brief.id, answers: [], outcome: { accepted: true } }, messageId: "m", answeredAt: T } : null,
          ...(extra.checklist === undefined ? {} : { checklist: extra.checklist }),
          ...(extra.sentWith === undefined ? {} : { sentWith: extra.sentWith }),
        }),
        answerBrief: accepted,
        approvalMembers: () => ({ members: [questions, demo] }),
        getDispatchPlace: () => ({ place: "here" }),
        listProjects: () => ({ kind: "found" as const, projects: [] }),
        ...({ threadFiles } as object),
        ...rpc,
      } as never,
    },
  );

describe("виджеты, которые прогон не держат", () => {
  it("Вопросы без кнопки отправки: поле комментария и строка, что правка уйдёт с Утверждением", async () => {
    const slot = open(questions);
    expect(await slot.findByText("Уйдёт агенту с Утверждением — агент пока работает дальше")).toBeTruthy();
    expect(slot.queryByRole("button", { name: /Отправить/ })).toBeNull();
    expect(slot.getByRole("textbox", { name: /Комментарий/ })).toBeTruthy();
  });

  it("без Утверждения впереди виджет показывает решённое агентом, поля комментария нет", async () => {
    const slot = open({ ...questions, settle: "agent" });
    expect(await slot.findByText("Решено агентом: Утверждения впереди нет")).toBeTruthy();
    expect(slot.queryByRole("textbox", { name: /Комментарий/ })).toBeNull();
  });

  it("Демонстрация перед Утверждением — с полем комментария", async () => {
    const slot = open(demo);
    expect(await slot.findByText("Уйдёт агенту с Утверждением — агент пока работает дальше")).toBeTruthy();
    expect(slot.getByRole("textbox", { name: /Комментарий/ })).toBeTruthy();
  });
});

describe("Утверждение уносит ответы группы", () => {
  it("правки виджетов — «Продолжить с правками · N», и их ответы уходят вместе с Утверждением", async () => {
    storeDraft("dec_q", setNote(pickOption(settledInitial(questions), fork, "b", questions), "без лишних файлов"));
    const answerBrief = vi.fn(accepted);
    const slot = open(approval, { answerBrief });
    const button = await slot.findByRole("button", { name: "Продолжить с правками · 2" });
    expect(slot.getByText("2 ответа, правки и комментария уйдут вместе с ним")).toBeTruthy();
    fireEvent.click(button);
    await vi.waitFor(() => expect(answerBrief).toHaveBeenCalled());
    const sent = answerBrief.mock.calls[0]![0] as unknown as { group: unknown[] };
    expect(sent.group).toEqual([
      { id: "dec_q", answer: { briefId: "dec_q", answers: [{ questionId: "go", optionIds: ["b"] }], note: "без лишних файлов" } },
      { id: "dec_d" },
    ]);
  });

  it("Ctrl+Enter уносит группу так же, как кнопка", async () => {
    storeDraft("dec_q", pickOption(settledInitial(questions), fork, "b", questions));
    const answerBrief = vi.fn(accepted);
    const slot = open(approval, { answerBrief });
    await slot.findByRole("button", { name: "Продолжить с правками · 1" });
    fireEvent.keyDown(slot.getByRole("textbox", { name: "Комментарий к утверждению" }), { key: "Enter", ctrlKey: true });
    await vi.waitFor(() => expect(answerBrief).toHaveBeenCalled());
    expect((answerBrief.mock.calls[0]![0] as unknown as { group: Array<{ id: string }> }).group.map((g) => g.id)).toEqual(["dec_q", "dec_d"]);
  });

  it("развилка без рекомендации в виджете группы держит «Продолжить» и называет виджет; на доработку — можно", async () => {
    const open_ = { ...fork, options: fork.options.map((o) => ({ ...o, recommended: false })) };
    const undecided = { ...questions, questions: [open_] };
    const slot = open(approval, { approvalMembers: () => ({ members: [undecided] }) });
    expect(await slot.findByText("Ответьте на вопросы в виджетах выше: Вопросы")).toBeTruthy();
    expect((slot.getByRole("button", { name: "Продолжить" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(slot.getByRole("textbox", { name: "Комментарий к утверждению" }), { target: { value: "переделай" } });
    expect((slot.getByRole("button", { name: "Отправить комментарии" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("Демонстрация, ушедшая с Утверждением, поля комментария больше не показывает", async () => {
    const slot = open(demo, {}, { sentWith: "dec_a" });
    expect(await slot.findByText("Ушло агенту с Утверждением")).toBeTruthy();
    expect(slot.queryByRole("textbox", { name: /Комментарий/ })).toBeNull();
  });

  it("комментарий к Утверждению — «Отправить комментарии», ответы группы не уходят", async () => {
    storeDraft("dec_q", setNote(settledInitial(questions), "x"));
    const answerBrief = vi.fn(accepted);
    const slot = open(approval, { answerBrief });
    await slot.findByRole("button", { name: "Продолжить с правками · 1" });
    fireEvent.change(slot.getByRole("textbox", { name: "Комментарий к утверждению" }), { target: { value: "переделай" } });
    fireEvent.click(slot.getByRole("button", { name: "Отправить комментарии" }));
    await vi.waitFor(() => expect(answerBrief).toHaveBeenCalled());
    expect((answerBrief.mock.calls[0]![0] as unknown as { group?: unknown }).group).toBeUndefined();
  });

  it("чек-лист — карточкой под ответом Утверждения: сколько отмечено и пункты", async () => {
    const items = [
      { id: "c1", where: "Вопросы", text: "без лишних файлов", done: true },
      { id: "c2", where: "Демонстрация", text: "проверь тему", done: false },
    ];
    const slot = open(approval, {}, { answered: true, checklist: items });
    const card = within(await slot.findByRole("group", { name: "Чек-лист по комментариям · 1 из 2" }));
    expect(card.getByText("без лишних файлов")).toBeTruthy();
    expect(slot.container.querySelector('[data-checklist-item="c2"]')?.getAttribute("data-done")).toBe("false");
  });
});
