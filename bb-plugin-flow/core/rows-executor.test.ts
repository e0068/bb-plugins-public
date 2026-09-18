// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { answerMessageText, deviations, openQuestions } from "./answer-message";
import { rowsOf, SETUP_ROW } from "./rows";

const brief: DecisionBrief = {
  id: "dec_1",
  threadId: "thr_1",
  title: "Бриф",
  createdAt: "2026-09-13T00:00:00.000Z",
  kind: "brief",
  revocable: true,
  setup: {
    artifacts: [
      { id: "task", name: "Задача", state: "approved", recommended: false, link: { label: "SL-1", target: "t.md" } },
      { id: "prototype", name: "HTML-прототип", state: "ready", recommended: true, link: { label: "p.html", target: "p.html" } },
      { id: "spec", name: "Спецификация", state: "stale", recommended: false },
      { id: "plan", name: "План", state: "missing", recommended: false },
    ],
    executor: { recommended: "subagents" },
    checker: { recommended: "agent", models: [{ name: "Opus 5", recommended: true }, { name: "Sonnet 5", recommended: false }] },
  },
  questions: [],
};

const row = (id: string) => rowsOf(brief).find((r) => r.id === id)!;
const view = (id: string) => row(id).options.map((o) => [o.id, o.action, o.recommended]);

const answer = (answers: Array<{ questionId: string; optionIds: string[] }>) => ({ briefId: brief.id, answers });

const recommended = [
  { questionId: SETUP_ROW.artifacts, optionIds: ["task", "prototype"] },
  { questionId: SETUP_ROW.executor, optionIds: ["subagents"] },
  { questionId: SETUP_ROW.checker, optionIds: ["agent:Opus 5"] },
];

describe("строки исполнителя и проверяющего", () => {
  it("идут за артефактами и приоритетом, до бюджетов", () => {
    expect(rowsOf(brief).map((r) => r.id)).toEqual([SETUP_ROW.artifacts, SETUP_ROW.executor, SETUP_ROW.checker]);
  });

  it("исполнитель — четыре способа с рекомендацией агента", () => {
    expect(row(SETUP_ROW.executor).question).toBe("Исполняет");
    expect(view(SETUP_ROW.executor)).toEqual([
      ["self", "Сам", false],
      ["subagents", "Субагенты", true],
      ["workflow", "Workflow", false],
      ["fanout", "Workflow с фанаутом", false],
    ]);
  });

  it("шаг workflow проверяет только работу, которую исполняет workflow", () => {
    const withChecker = (executor: string) =>
      openQuestions(brief, answer([recommended[0]!, { questionId: SETUP_ROW.executor, optionIds: [executor] }, { questionId: SETUP_ROW.checker, optionIds: ["workflow"] }]));
    expect(withChecker("self")).toEqual([SETUP_ROW.checker]);
    expect(withChecker("workflow")).toEqual([]);
    expect(withChecker("fanout")).toEqual([]);
  });
});

describe("утверждённый артефакт в строке артефактов", () => {
  it("входит в строку отмеченным по умолчанию: утверждение можно отозвать", () => {
    expect(view(SETUP_ROW.artifacts)).toEqual([
      ["task", "Задача — оставить утверждённым", true],
      ["prototype", "HTML-прототип — утвердить", true],
      ["spec", "Спецификация — сделать", false],
      ["plan", "План — сделать", false],
    ]);
  });

  it("снятая галочка у утверждённого уходит агенту как «отозвать утверждение» и считается расхождением", () => {
    const revoked = answer([{ questionId: SETUP_ROW.artifacts, optionIds: ["prototype"] }, ...recommended.slice(1)]);
    expect(answerMessageText(brief, revoked)).toContain("отозвать утверждение — Задача");
    expect(deviations(brief, revoked)).toBe(1);
    expect(answerMessageText(brief, answer(recommended))).not.toContain("отозвать утверждение");
  });
});
