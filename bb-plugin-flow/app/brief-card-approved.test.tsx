// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DecisionBrief, decisionsRpcContract } from "../shared/contract";

const app = await loadPluginApp(() => import("../app"));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const brief: DecisionBrief = {
  id: "dec_approved",
  threadId: "thr_1",
  title: "Развилка посреди работы",
  createdAt: "2026-10-01T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  launched: true,
  approved: ["Все тесты зелёные", "Кнопка на месте"],
  questions: [
    {
      id: "how",
      kind: "fork",
      allowOwn: false,
      question: "Как рисовать?",
      options: [
        { id: "panel", action: "Панелью", description: "…", recommended: true, add: { target: 2, max: 3, risk: 0, minutes: 20 }, criteria: ["Панель не перекрывает ленту"] },
        { id: "pop", action: "Поповером", description: "…", recommended: false, add: { target: 0, max: 0, risk: 1 } },
      ],
    },
  ],
};

const open = () =>
  renderSlot<PluginMessageDirectiveProps, typeof decisionsRpcContract>(
    app.messageDirectives[0]!,
    { attributes: { id: brief.id }, source: `::decision{id="${brief.id}"}`, message: { id: "msg_1", threadId: "thr_1", turnId: "turn_1", projectId: null }, openWorkspaceFile: () => true },
    { rpc: { getBrief: () => ({ kind: "found", brief, answer: null }), answerBrief: () => ({ kind: "not_found" }) } },
  );

describe("бриф посреди работы", () => {
  it("утверждённые пункты свёрнуты строкой со счётом и разворачиваются целиком", async () => {
    const slot = open();
    const criteria = await slot.findByRole("group", { name: "Готово, когда" });
    expect(criteria.textContent).not.toContain("Все тесты зелёные");
    fireEvent.click(within(criteria).getByRole("button", { name: "Утверждённые пункты · 2" }));
    expect(criteria.textContent).toContain("Все тесты зелёные");
    expect(criteria.textContent).toContain("Кнопка на месте");
    fireEvent.click(within(criteria).getByRole("button", { name: "Свернуть" }));
    expect(criteria.textContent).not.toContain("Все тесты зелёные");
  });

  it("пункт выбранного варианта стоит рядом с утверждёнными", async () => {
    const slot = open();
    fireEvent.click(within(await slot.findByRole("group", { name: "Как рисовать?" })).getByRole("button", { name: /Панелью/ }));
    const criteria = slot.getByRole("group", { name: "Готово, когда" });
    expect(criteria.textContent).toContain("Панель не перекрывает ленту");
    expect(within(criteria).getByRole("button", { name: "Утверждённые пункты · 2" })).toBeTruthy();
  });

  it("вариант показывает свою цену, а итога бюджета нет", async () => {
    const slot = open();
    const option = within(await slot.findByRole("group", { name: "Как рисовать?" })).getByRole("button", { name: /Панелью/ });
    expect(option.textContent).toContain("+$2–3");
    expect(slot.queryByRole("button", { name: /^Бюджет/ })).toBeNull();
  });
});
