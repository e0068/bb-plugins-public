// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { report, stagedBrief } from "../core/stages-fixtures";
import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const brief: DecisionBrief = stagedBrief([report("task", { recommended: true }), report("spec"), report("plan")], {
  title: "Заголовок агента",
  intro: "Подзаголовок агента",
  setup: { stages: [report("task", { recommended: true }), report("spec"), report("plan")], criteria: ["Тесты зелёные", "Сборка проходит"] },
  questions: [{ id: "q", kind: "confirm", question: "Правильно понял?", allowOwn: false, context: "Так", options: [{ id: "yes", action: "Да", recommended: true }] }],
});

const clarify: DecisionBrief = {
  id: "dec_clarify",
  threadId: "thr_1",
  title: "Светлая тема",
  createdAt: "2026-09-16T10:00:00.000Z",
  kind: "clarify",
  questions: [{ id: "light", kind: "yesno", question: "Снимать светлую тему?", allowOwn: false, options: [{ id: "yes", action: "Да", recommended: true }, { id: "no", action: "Нет", recommended: false }] }],
};

const open = (b: DecisionBrief) =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: b.id }, source: `::decision{id="${b.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief: b, answer: null }), answerBrief: () => ({ kind: "not_found" }) } },
  );

const tags = (slot: ReturnType<typeof open>) => [...slot.container.querySelectorAll("[data-section-tag]")].map((el) => el.textContent);

describe("бирки частей брифа", () => {
  it("над вопросами, критерием и этапами — бирки вида; заголовка и подзаголовка агента в форме нет", async () => {
    const slot = open(brief);
    await slot.findByRole("group", { name: "Ответ на бриф" });
    expect(tags(slot)).toEqual(["Вопросы", "Критерии · оставлено 2 из 2", "Выбор этапов"]);
    expect(slot.queryByText("Заголовок агента")).toBeNull();
    expect(slot.queryByText("Подзаголовок агента")).toBeNull();
    expect(slot.getByRole("group", { name: "Заголовок агента" })).toBeTruthy();
  });

  it("бирка — без подложки", async () => {
    const slot = open(brief);
    await slot.findByRole("group", { name: "Ответ на бриф" });
    for (const tag of slot.container.querySelectorAll("[data-section-tag]")) expect(tag.className).not.toMatch(/\bbg-/);
  });

  it("уточнение подписано биркой «Уточнение» и отвечается касанием", async () => {
    const slot = open(clarify);
    await slot.findByText("Снимать светлую тему?");
    expect(tags(slot)).toEqual(["Уточнение"]);
    expect(slot.queryByRole("button", { name: /Отправить/ })).toBeNull();
  });
});
