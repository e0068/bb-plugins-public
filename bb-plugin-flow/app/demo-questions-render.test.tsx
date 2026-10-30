// @vitest-environment jsdom
// Вопрос по демо стоит в самой карточке демонстрации, а ответ на него уходит с Утверждением группы.
import { cleanup, fireEvent } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { settledInitial } from "./approval-edits";
import { pickOption } from "./draft";
import { storeDraft } from "./draft-storage";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const T = "2026-10-29T10:00:00.000Z";
const stages = { list: [builtinStage("demo", []), builtinStage("approve", [])], minButtonWidth: 160 };
const fork = { id: "bevel", kind: "fork" as const, question: "Чинить фаску в Retro Dark?", allowOwn: false, options: [{ id: "fix", action: "Чинить", description: "Светлая грань светлее тёмной.", recommended: true }, { id: "keep", action: "Оставить как есть", description: "Тема не светлеет.", recommended: false }] };
const outcome = (stage: string) => ({ stage, final: false, next: "Дальше", done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] });
const demo: DecisionBrief = { id: "dec_d", threadId: "thr_1", title: "Демонстрация", createdAt: T, kind: "brief", questions: [fork], stages, settle: "approval", outcome: outcome("demo") };
const approval: DecisionBrief = { id: "dec_a", threadId: "thr_1", title: "Утверждение", createdAt: T, kind: "brief", questions: [], stages, outcome: outcome("approve") };

const accepted = (input: { answer: DecisionAnswer }) => ({ kind: "accepted" as const, record: { answer: input.answer, messageId: "msg_1", answeredAt: T } });

const open = (brief: DecisionBrief, rpc: Record<string, unknown> = {}) =>
  renderSlot<PluginMessageDirectiveProps, never>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief, answer: null }),
        answerBrief: accepted,
        approvalMembers: () => ({ members: [demo] }),
        getDispatchPlace: () => ({ place: "here" }),
        listProjects: () => ({ kind: "found" as const, projects: [] }),
        ...({ threadFiles } as object),
        ...rpc,
      } as never,
    },
  );

describe("вопрос в карточке демонстрации", () => {
  it("демо с Утверждением впереди показывает вопрос с вариантами и поле комментария, без кнопки отправки", async () => {
    const slot = open(demo);
    expect(await slot.findByRole("group", { name: "Чинить фаску в Retro Dark?" })).toBeTruthy();
    expect(slot.getByText("Оставить как есть")).toBeTruthy();
    expect(slot.getByRole("textbox", { name: /Комментарий/ })).toBeTruthy();
    expect(slot.queryByRole("button", { name: /Отправить/ })).toBeNull();
  });

  it("демо без вопросов остаётся отчётом: вопроса и вариантов нет", async () => {
    const slot = open({ ...demo, questions: [] });
    expect(await slot.findByRole("textbox", { name: /Комментарий/ })).toBeTruthy();
    expect(slot.queryByRole("group", { name: "Чинить фаску в Retro Dark?" })).toBeNull();
  });

  it("ответ на вопрос демо уходит с Утверждением и считается его правкой", async () => {
    storeDraft("dec_d", pickOption(settledInitial(demo), fork, "keep", demo));
    const answerBrief = vi.fn(accepted);
    const slot = open(approval, { answerBrief });
    fireEvent.click(await slot.findByRole("button", { name: "Продолжить с правками · 1" }));
    await vi.waitFor(() => expect(answerBrief).toHaveBeenCalled());
    const sent = answerBrief.mock.calls[0]![0] as unknown as { group: unknown[] };
    expect(sent.group).toEqual([{ id: "dec_d", answer: { briefId: "dec_d", answers: [{ questionId: "bevel", optionIds: ["keep"] }] } }]);
  });
});
