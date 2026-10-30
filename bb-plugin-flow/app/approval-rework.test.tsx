// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionAnswer, DecisionBrief, GroupAnswer } from "../shared/contract";
import { settledInitial } from "./approval-edits";
import type { StoredPool } from "./attachment-store";
import { pickOption, setNote } from "./draft";
import { storeDraft } from "./draft-storage";
import { threadFiles } from "./file-roots-fixture";

// Владелец написал комментарии и вставил картинки в виджеты над Утверждением: Утверждение уносит их, что бы владелец ни нажал.

/** IndexedDB окна — словарь: картинки, вставленные в поле Демонстрации, лежат в её пуле. */
const disk = vi.hoisted(() => new Map<string, StoredPool>());
vi.mock("./attachment-store", () => ({
  loadPool: async (briefId: string) => disk.get(briefId) ?? null,
  savePool: async (briefId: string, pool: StoredPool) => void disk.set(briefId, structuredClone(pool)),
  dropPool: async (briefId: string) => void disk.delete(briefId),
}));

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => {
  window.localStorage.clear();
  disk.clear();
});
afterEach(cleanup);

const T = "2026-10-29T10:00:00.000Z";
const stages = { list: [builtinStage("questions", []), builtinStage("demo", []), builtinStage("approve", [])], minButtonWidth: 160 };
const fork = { id: "go", kind: "choice" as const, question: "Как делаем?", allowOwn: false, options: [{ id: "a", action: "Просто", recommended: true }, { id: "b", action: "Сложно", recommended: false }] };
const questions: DecisionBrief = { id: "dec_rq", threadId: "thr_1", title: "Вопросы", createdAt: T, kind: "brief", settle: "approval", questions: [fork] };
const outcome = (stage: string) => ({ stage, final: false, next: "Дальше", done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] });
const demo: DecisionBrief = { id: "dec_rd", threadId: "thr_1", title: "Демонстрация", createdAt: T, kind: "brief", questions: [], stages, settle: "approval", outcome: outcome("demo") };
const approval: DecisionBrief = { id: "dec_ra", threadId: "thr_1", title: "Утверждение", createdAt: T, kind: "brief", questions: [], stages, outcome: outcome("approve") };

const accepted = (input: { answer: DecisionAnswer }) => ({ kind: "accepted" as const, record: { answer: input.answer, messageId: "msg_1", answeredAt: T } });

const open = (answerBrief: ReturnType<typeof vi.fn>, members: readonly DecisionBrief[] = [questions, demo]) =>
  renderSlot<PluginMessageDirectiveProps, never>(
    app.messageDirectives[0]!,
    { attributes: { id: approval.id }, source: `::decision{id="${approval.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief: approval, answer: null }),
        answerBrief,
        approvalMembers: () => ({ members }),
        getDispatchPlace: () => ({ place: "here" }),
        listProjects: () => ({ kind: "found" as const, projects: [] }),
        ...({ threadFiles } as object),
      } as never,
    },
  );

const sentGroup = (answerBrief: ReturnType<typeof vi.fn>): GroupAnswer[] => (answerBrief.mock.calls[0]![0] as { group: GroupAnswer[] }).group;

describe("Утверждение «на доработку» уносит ответы и комментарии своей группы", () => {
  it("«Отправить комментарии»: ответ Вопросов и комментарий Демонстрации уходят вместе с комментарием Утверждения", async () => {
    storeDraft(questions.id, pickOption(settledInitial(questions), fork, "b", questions));
    storeDraft(demo.id, setNote(settledInitial(demo), "кнопка слишком яркая"));
    const answerBrief = vi.fn(accepted);
    const slot = open(answerBrief);
    await slot.findByRole("button", { name: "Продолжить с правками · 2" });
    fireEvent.change(slot.getByRole("textbox", { name: "Комментарий к утверждению" }), { target: { value: "Доработай по комментариям" } });
    fireEvent.click(slot.getByRole("button", { name: "Отправить комментарии" }));
    await vi.waitFor(() => expect(answerBrief).toHaveBeenCalled());
    expect(sentGroup(answerBrief)).toEqual([
      { id: questions.id, answer: { briefId: questions.id, answers: [{ questionId: "go", optionIds: ["b"] }] } },
      { id: demo.id, note: "кнопка слишком яркая" },
    ]);
  });
});

describe("картинки из полей виджетов группы уходят с Утверждением", () => {
  /** Пул картинок поднимается из IndexedDB один раз на бриф за жизнь модуля, поэтому у каждого теста своя Демонстрация. */
  const demoOf = (id: string): DecisionBrief => ({ ...demo, id });
  const pooled = (bytes: string): StoredPool => ({ next: 2, images: [{ n: 1, mimeType: "image/png", dataBase64: Buffer.from(bytes).toString("base64"), weight: bytes.length }] });

  it("«Продолжить с правками»: картинка из комментария Демонстрации — в её ответе группы", async () => {
    const own = demoOf("dec_rd_continue");
    disk.set(own.id, pooled("demo"));
    storeDraft(own.id, setNote(settledInitial(own), "кнопка [Изображение 1]"));
    const answerBrief = vi.fn(accepted);
    const slot = open(answerBrief, [own]);
    fireEvent.click(await slot.findByRole("button", { name: "Продолжить с правками · 1" }));
    await vi.waitFor(() => expect(answerBrief).toHaveBeenCalled());
    const images = sentGroup(answerBrief).find((member) => member.id === own.id)?.images ?? [];
    expect(images.map(({ n, dataBase64 }) => ({ n, text: Buffer.from(dataBase64, "base64").toString() }))).toEqual([{ n: 1, text: "demo" }]);
  });

  it("«Отправить комментарии»: картинка из комментария Демонстрации — тоже в её ответе группы", async () => {
    const own = demoOf("dec_rd_rework");
    disk.set(own.id, pooled("demo"));
    storeDraft(own.id, setNote(settledInitial(own), "кнопка [Изображение 1]"));
    const answerBrief = vi.fn(accepted);
    const slot = open(answerBrief, [own]);
    await slot.findByRole("button", { name: "Продолжить с правками · 1" });
    fireEvent.change(slot.getByRole("textbox", { name: "Комментарий к утверждению" }), { target: { value: "переделай" } });
    fireEvent.click(slot.getByRole("button", { name: "Отправить комментарии" }));
    await vi.waitFor(() => expect(answerBrief).toHaveBeenCalled());
    expect(sentGroup(answerBrief).find((member) => member.id === own.id)?.images).toHaveLength(1);
  });
});
