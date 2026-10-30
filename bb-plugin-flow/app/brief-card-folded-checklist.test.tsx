// @vitest-environment jsdom
import { cleanup, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import { builtinStage } from "../lib/stage-constants";
import type { AnswerRecord, ChecklistItem, DecisionBrief, Fold } from "../shared/contract";
import { threadFiles } from "./file-roots-fixture";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const T = "2026-10-29T10:00:00.000Z";
const outcome = (stage: string) => ({ stage, final: false, next: "Дальше", done: ["Сделано"], pending: [], results: [{ label: "a.md", target: "a.md" }] });
const stages = { list: [builtinStage("demo", []), builtinStage("approve", [])], minButtonWidth: 160 };
const demo: DecisionBrief = { id: "dec_fd", threadId: "thr_1", title: "Демонстрация", createdAt: T, kind: "brief", questions: [], stages, settle: "approval", outcome: outcome("demo") };
const approval: DecisionBrief = { id: "dec_fa", threadId: "thr_1", title: "Утверждение", createdAt: T, kind: "brief", questions: [], stages, outcome: outcome("approve") };
const rework: AnswerRecord = { answer: { briefId: approval.id, answers: [], outcome: { accepted: false, note: "переделай" } }, messageId: "msg_1", answeredAt: T };
const fold: Fold = { holder: approval.id, ids: [demo.id, approval.id] };
const items: ChecklistItem[] = [{ id: "c1", where: "Демонстрация", text: "кнопка слишком яркая", done: false }];

const open = (id: string, found: Record<string, unknown>) =>
  renderSlot<PluginMessageDirectiveProps, never>(
    app.messageDirectives[0]!,
    { attributes: { id }, source: `::decision{id="${id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { ...({ threadFiles } as object), answerBrief: () => ({ kind: "not_found" }), getBrief: ({ id: asked }: { id: string }) => found[asked] ?? { kind: "not_found" } } as never },
  );

describe("«на доработку» свернуло группу, а чек-лист по комментариям остаётся на виду", () => {
  it("под свёрнутой строкой Утверждения — карточка чек-листа с пунктами", async () => {
    const slot = open(approval.id, { [approval.id]: { kind: "found", brief: approval, answer: rework, fold, checklist: items } });
    const card = within(await slot.findByRole("group", { name: "Чек-лист по комментариям · 0 из 1" }));
    expect(card.getByText("кнопка слишком яркая")).toBeTruthy();
  });

  it("свёрнутый виджет группы — не держатель: чек-листа под ним нет", async () => {
    const slot = open(demo.id, { [demo.id]: { kind: "found", brief: demo, answer: null, fold, checklist: items } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(slot.queryByRole("group", { name: /Чек-лист/ })).toBeNull();
  });
});
