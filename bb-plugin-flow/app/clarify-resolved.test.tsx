// @vitest-environment jsdom
// Уточнение, которое агент починил или решил сам (`resolves` в ask_decision): одна приглушённая строка «Решено: …» без кнопок ответа.
import { cleanup } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it } from "vitest";

import type { AnswerRecord, DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

afterEach(cleanup);

const yesno: DecisionBrief = {
  id: "dec_resolved_yesno",
  threadId: "thr_1",
  title: "Починить сразу?",
  createdAt: "2026-10-12T12:00:00.000Z",
  kind: "clarify",
  questions: [{ id: "ok", kind: "yesno", question: "Чинить [spec](docs/spec.md) сразу?", allowOwn: false, options: [{ id: "yes", action: "Да", recommended: false }, { id: "no", action: "Нет", recommended: false }] }],
};

const fork: DecisionBrief = {
  id: "dec_resolved_fork",
  threadId: "thr_1",
  title: "Вид списка",
  createdAt: "2026-10-12T12:00:00.000Z",
  kind: "clarify",
  questions: [{ id: "ui", kind: "fork", question: "Панель или поповер?", allowOwn: false, options: [{ id: "panel", action: "Панель", recommended: false }, { id: "pop", action: "Поповер", recommended: false }] }],
};

const several: DecisionBrief = {
  ...fork,
  id: "dec_resolved_several",
  questions: [...fork.questions, { id: "more", kind: "yesno", question: "Нужна ли анимация?", allowOwn: false, options: [{ id: "yes", action: "Да", recommended: false }, { id: "no", action: "Нет", recommended: false }] }],
};

const answered: AnswerRecord = { messageId: "msg_1", answeredAt: "2026-10-12T12:05:00.000Z", answer: { briefId: fork.id, answers: [{ questionId: "ui", optionIds: ["pop"] }] } };

const open = (brief: DecisionBrief, found: { resolved?: true; answer?: AnswerRecord } = { resolved: true }) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: null },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: found.answer ?? null, ...(found.resolved === true ? { resolved: true as const } : {}) }), answerBrief: () => ({ kind: "not_found" }) } },
  );

describe("решённое уточнение", () => {
  it("уточнение да/нет — строка «Решено: <вопрос>» без «Да» и «Нет»; ссылка в вопросе — подписью", async () => {
    const slot = open(yesno);
    expect(await slot.findByText("Решено: Чинить spec сразу?")).toBeTruthy();
    expect(slot.queryByRole("button", { name: "Да" })).toBeNull();
    expect(slot.queryByRole("button", { name: "Нет" })).toBeNull();
  });

  it("форма с развилкой — тоже строка: ни вариантов, ни «Отправить ответы»", async () => {
    const slot = open(fork);
    expect(await slot.findByText("Решено: Панель или поповер?")).toBeTruthy();
    expect(slot.queryByRole("button")).toBeNull();
  });

  it("несколько вопросов — заголовок уточнения", async () => {
    const slot = open(several);
    expect(await slot.findByText("Решено: Вид списка")).toBeTruthy();
    expect(slot.queryByText(/Нужна ли анимация/)).toBeNull();
  });

  it("строка со значком «галочка в круге», приглушённая", async () => {
    const slot = open(fork);
    const line = (await slot.findByText("Решено: Панель или поповер?")).closest("[data-brief-resolved]")!;
    expect(line.querySelector('[data-icon="CircleCheck"]')).not.toBeNull();
    expect(line.className).toContain("text-muted-foreground");
  });

  it("ответ владельца, пришедший раньше, остаётся ответом: отвеченное уточнение, не «Решено»", async () => {
    const slot = open(fork, { answer: answered });
    expect(await slot.findByText("Уточнение отвечено")).toBeTruthy();
    expect(slot.queryByText(/Решено:/)).toBeNull();
  });

  it("без признака — обычное уточнение с кнопками", async () => {
    const slot = open(yesno, {});
    expect(await slot.findByRole("button", { name: "Да" })).toBeTruthy();
    expect(slot.queryByText(/Решено:/)).toBeNull();
  });

  it("признак у не-уточнения ничего не меняет: бриф остаётся брифом", async () => {
    const brief: DecisionBrief = { ...fork, id: "dec_resolved_brief", kind: "brief" };
    const slot = open(brief);
    expect(await slot.findByRole("button", { name: /Поповер/ })).toBeTruthy();
    expect(slot.queryByText(/Решено:/)).toBeNull();
  });
});

describe("уточнение закрывается на глазах", () => {
  it("сигнал decisions:answered после resolves перерисовывает открытое уточнение строкой «Решено», кнопок нет", async () => {
    let resolved = false;
    const slot = renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
      app.messageDirectives[0]!,
      { attributes: { id: yesno.id }, source: `::decision{id="${yesno.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: null },
      { rpc: { getBrief: () => ({ kind: "found", brief: yesno, answer: null, ...(resolved ? { resolved: true as const } : {}) }), answerBrief: () => ({ kind: "not_found" }) } },
    );
    expect(await slot.findByRole("button", { name: "Да" })).toBeTruthy();
    resolved = true;
    await slot.emitRealtime("decisions:answered", { id: yesno.id });
    expect(await slot.findByText("Решено: Чинить spec сразу?")).toBeTruthy();
    expect(slot.queryByRole("button", { name: "Да" })).toBeNull();
  });
});
