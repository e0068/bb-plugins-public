// @vitest-environment jsdom
// Отвеченная демонстрация с вопросами остаётся отчётом: без вердикта «Комментарий», со статусом «Ушло агенту с Утверждением».
import { cleanup } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const T = "2026-10-29T10:00:00.000Z";
const stages = { list: [builtinStage("demo", []), builtinStage("approve", [])], minButtonWidth: 160 };
const fork = { id: "bevel", kind: "fork" as const, question: "Чинить фаску в Retro Dark?", allowOwn: false, options: [{ id: "fix", action: "Чинить", description: "Светлая грань светлее тёмной.", recommended: true }, { id: "keep", action: "Оставить как есть", description: "Тема не светлеет.", recommended: false }] };
const demo: DecisionBrief = { id: "dec_d", threadId: "thr_1", title: "Демонстрация", createdAt: T, kind: "brief", questions: [fork], stages, settle: "approval", outcome: { stage: "demo", final: false, next: "Дальше", done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] } };

const open = (answer: DecisionAnswer) =>
  renderSlot<PluginMessageDirectiveProps, never>(
    app.messageDirectives[0]!,
    { attributes: { id: demo.id }, source: `::decision{id="${demo.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief: demo, answer: { answer, messageId: "m", answeredAt: T } }),
        getDispatchPlace: () => ({ place: "here" }),
        listProjects: () => ({ kind: "found" as const, projects: [] }),
        ...({ threadFiles } as object),
      } as never,
    },
  );

const answered = { briefId: "dec_d", answers: [{ questionId: "bevel", optionIds: ["keep"] }] };

describe("отвеченная демонстрация с вопросами", () => {
  it("без вердикта «Комментарий» и «Ответ отправлен»: ушла с Утверждением", async () => {
    const slot = open(answered);
    expect(await slot.findByText("Ушло агенту с Утверждением")).toBeTruthy();
    expect(slot.queryByText("Комментарий")).toBeNull();
    expect(slot.queryByText("Ответ отправлен")).toBeNull();
  });

  it("комментарий владельца подписан как комментарий к демо, а не «Ко всем вопросам»", async () => {
    const slot = open({ ...answered, note: "проверь тёмную тему" });
    expect(await slot.findByText("проверь тёмную тему")).toBeTruthy();
    expect(slot.queryByText("Ко всем вопросам:")).toBeNull();
  });

  it("старая запись ответа на демо с итогом сохраняет свой вердикт", async () => {
    const slot = open({ briefId: "dec_d", answers: [], outcome: { accepted: false, note: "Поправь подпись" } });
    expect(await slot.findByText("Комментарий")).toBeTruthy();
    expect(slot.getByText(/Поправь подпись/)).toBeTruthy();
  });
});
