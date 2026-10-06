// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { budgetLine, forecast, hasForecast } from "./budget";
import { add } from "./stages-fixtures";

/**
 * Бриф-уточнение посреди работы: прогон утверждён за $35–63 и 175 мин при объёме $7–12.6 и 35 мин —
 * каждый доллар объёма стоил прогону пять.
 */
const midWork: DecisionBrief = {
  id: "dec_mid",
  threadId: "thr_1",
  title: "Через какой канал",
  createdAt: "2026-10-03T00:00:00.000Z",
  kind: "brief",
  launched: true,
  approvedBudget: { minutes: 175, target: 35, max: 63 },
  approvedScope: add(7, 12.6, 2, 35),
  questions: [
    {
      id: "how",
      kind: "fork",
      allowOwn: false,
      question: "Канал?",
      options: [
        { id: "feed", action: "Лента на витрине", recommended: true, add: add(2, 3, 1, 12) },
        { id: "free", action: "Ничего не менять", recommended: false, add: add(0, 0, 0, 0) },
      ],
    },
  ],
};

const chose = (brief: DecisionBrief, optionId: string): DecisionAnswer => ({ briefId: brief.id, answers: [{ questionId: "how", optionIds: [optionId] }] });

describe("бюджет брифа посреди работы", () => {
  it("бриф посреди работы с утверждённым бюджетом держит прогноз", () => {
    expect(hasForecast(midWork)).toBe(true);
  });

  it("бриф посреди работы, записанный без утверждённого бюджета, прогноза не держит", () => {
    const { approvedBudget: _, ...old } = midWork;
    expect(hasForecast(old)).toBe(false);
  });

  it("итог — утверждённый бюджет плюс цена варианта с множителем прогона", () => {
    const f = forecast(midWork, chose(midWork, "feed"));
    expect([f.target, f.max, f.minutes, f.risk]).toEqual([45, 78, 235, 1]);
  });

  it("вариант без цены оставляет утверждённый бюджет как был", () => {
    const f = forecast(midWork, chose(midWork, "free"));
    expect([f.target, f.max, f.minutes]).toEqual([35, 63, 175]);
  });

  it("разбивка начинается утверждённым бюджетом, за ним — выбранный вариант со своей долей прогона", () => {
    const f = forecast(midWork, chose(midWork, "feed"));
    expect(f.lines.map((l) => [l.label, l.note, l.target, l.max, l.minutes])).toEqual([
      ["Утверждено при запуске", "", 35, 63, 175],
      ["Вопрос 1", "Лента на витрине", 10, 15, 60],
    ]);
  });

  it("без утверждённого объёма цена варианта идёт в итог как есть", () => {
    const { approvedScope: _, ...noScope } = midWork;
    const f = forecast(noScope, chose(noScope, "feed"));
    expect([f.target, f.max, f.minutes]).toEqual([37, 66, 187]);
  });

  it("план прогона без времени даёт итог без времени, а не минуты одного варианта", () => {
    const noTime = { ...midWork, approvedBudget: { minutes: null, target: 35, max: 63 } };
    expect(forecast(noTime, chose(noTime, "feed")).minutes).toBeNull();
  });

  it("вариант без времени оставляет время итога утверждённым", () => {
    const untimed = { ...midWork, questions: [{ ...midWork.questions[0]!, options: [{ id: "feed", action: "Лента", recommended: true, add: { target: 2, max: 3, risk: 1 } }] }] };
    expect(forecast(untimed, chose(untimed, "feed")).minutes).toBe(175);
  });

  it("строка «Бюджет» ответа агенту несёт новый итог", () => {
    expect(budgetLine(midWork, chose(midWork, "feed"), "ru")).toEqual(["Бюджет — прогноз $45 · до $78, риск +1, время 235 мин"]);
  });
});
