// @vitest-environment jsdom
import { cleanup, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn(async () => ({ svg: "<svg data-drawn></svg>" })) }));
vi.mock("mermaid", () => ({ default: mermaid }));

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
    notes: "Схема поставки.\n\n```mermaid\nflowchart LR\n  S --> C\n\n  C --> G\n```\n\nОба варианта ниже.",
    sections: [{ title: "Как устроено", text: "```mermaid\nsequenceDiagram\n  A->>B: hi\n```" }],
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

describe("mermaid в Демонстрации", () => {
  it("блоки mermaid в заметках и секциях нарисованы диаграммами, абзацы вокруг — текстом", async () => {
    const c = await card(open());
    await vi.waitFor(() => expect(document.querySelectorAll("[data-mermaid] svg")).toHaveLength(2), { timeout: 3000 });
    c.getByText("Оба варианта ниже.");
    c.getByText("Как устроено");
    expect(c.queryByText(/```/)).toBeNull();
  });
});
