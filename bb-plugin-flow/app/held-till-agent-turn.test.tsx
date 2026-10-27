// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { AgentTurn, DecisionBrief } from "../shared/contract";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const T = "2026-10-26T10:00:00.000Z";
const fork = { id: "go", kind: "fork" as const, question: "Как делаем?", allowOwn: false, options: [{ id: "a", action: "Просто", description: "Одним файлом.", recommended: true }, { id: "b", action: "Сложно", description: "Тремя слоями.", recommended: false }] };
const questions: DecisionBrief = { id: "dec_q", threadId: "thr_1", title: "Вопросы", createdAt: T, kind: "brief", settle: "approval", questions: [fork] };
const stages = { list: [builtinStage("questions", []), builtinStage("demo", []), builtinStage("approve", [])], minButtonWidth: 160 };
const demo: DecisionBrief = { id: "dec_d", threadId: "thr_1", title: "Демонстрация", createdAt: T, kind: "brief", questions: [], stages, settle: "approval", outcome: { stage: "demo", final: false, next: "Дальше", done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] } };

const working = "Уйдёт агенту с Утверждением — агент пока работает дальше";
const waiting = "Уйдёт агенту с Утверждением — агент ждёт его";

/** Виджет, копящий ответ до Утверждения; ход агента отдаёт `turn` — его можно сменить событием. */
const open = (brief: DecisionBrief, turn: AgentTurn) =>
  renderSlot<PluginMessageDirectiveProps, never>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    {
      rpc: {
        getBrief: () => ({ kind: "found", brief, answer: null }),
        agentTurn: () => ({ turn }),
        getDispatchPlace: () => ({ place: "here" }),
        listProjects: () => ({ kind: "found" as const, projects: [] }),
        ...({ threadFiles } as object),
      } as never,
    },
  );

describe("подпись виджета, который ждёт Утверждения, и ход агента", () => {
  it("ход идёт — агент работает дальше", async () => {
    const slot = open(questions, "running");
    expect(await slot.findByText(working)).toBeTruthy();
  });

  it("ход кончился — агент ждёт Утверждения, про работу ни слова", async () => {
    const slot = open(questions, "ended");
    expect(await slot.findByText(waiting)).toBeTruthy();
    expect(slot.queryByText(working)).toBeNull();
  });

  it("ход кончился, пока виджет открыт, — подпись меняется без перезагрузки", async () => {
    const slot = open(demo, "running");
    expect(await slot.findByText(working)).toBeTruthy();
    await slot.emitRealtime("decisions:turn", { threadId: "thr_1", turn: "ended" });
    expect(await slot.findByText(waiting)).toBeTruthy();
  });

  it("агент снова пошёл в ход — подпись возвращается к «работает дальше»", async () => {
    const slot = open(questions, "ended");
    expect(await slot.findByText(waiting)).toBeTruthy();
    await slot.emitRealtime("decisions:turn", { threadId: "thr_1", turn: "running" });
    expect(await slot.findByText(working)).toBeTruthy();
    expect(slot.queryByText(waiting)).toBeNull();
  });
});
