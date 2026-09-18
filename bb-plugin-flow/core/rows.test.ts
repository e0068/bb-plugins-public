// @vitest-environment node
import { describe, expect, it } from "vitest";

import { SETUP_ID_PREFIX, type DecisionBrief, type DecisionQuestion } from "../shared/contract";
import { answerMessageText, deviations, openQuestions } from "./answer-message";
import { isLegacyBrief, rowsOf, SETUP_ROW } from "./rows";

const scale = (...actions: string[]) => ({
  options: actions.map((action, i) => ({ id: `o${i}`, action, recommended: i === 1 })),
});

const fork: DecisionQuestion = {
  id: "how",
  question: "Как устроена?",
  kind: "fork",
  allowOwn: false,
  options: [
    { id: "a", action: "Строки", recommended: true, description: "…", cost: "~1M", risk: "M" },
    { id: "b", action: "Вопросы", recommended: false, description: "…", cost: "~1M", risk: "XS" },
  ],
};

const pick: DecisionQuestion = {
  id: "edits",
  question: "Какие правки?",
  kind: "pick",
  allowOwn: false,
  options: [
    { id: "row", action: "Строка дерева", recommended: true, description: "…" },
    { id: "depth", action: "Глубина", recommended: false, description: "…" },
  ],
};

const confirm: DecisionQuestion = {
  id: "read",
  question: "Правильно ли я понял?",
  kind: "confirm",
  allowOwn: false,
  options: [{ id: "yes", action: "Да", recommended: true }],
};

const brief: DecisionBrief = {
  id: "dec_1",
  threadId: "thr_1",
  title: "Бриф",
  createdAt: "2026-09-13T00:00:00.000Z",
  kind: "brief",
  setup: {
    artifacts: [
      { id: "task", name: "Задача", state: "approved", recommended: false, link: { label: "SL-1", target: "t.md" } },
      { id: "proto", name: "Прототип", state: "ready", recommended: false, link: { label: "p", target: "p.html" } },
      { id: "spec", name: "Спека", state: "stale", recommended: true },
      { id: "plan", name: "План", state: "missing", recommended: true },
    ],
    budgetTarget: scale("—", "$30", "$45"),
    budgetMax: scale("—", "$60", "$100"),
  },
  questions: [fork, pick, confirm],
};

describe("строки брифа", () => {
  it("строки первой части носят префикс контракта", () => {
    for (const id of Object.values(SETUP_ROW)) expect(id.startsWith(SETUP_ID_PREFIX)).toBe(true);
  });

  it("старым считается бриф с toggles, choice или yesno внутри брифа", () => {
    expect(isLegacyBrief(brief)).toBe(false);
    const legacy = { ...brief, setup: undefined, questions: [{ ...fork, id: "t", kind: "toggles" as const }] };
    expect(isLegacyBrief(legacy)).toBe(true);
    const clarify: DecisionBrief = { ...brief, kind: "clarify", setup: undefined, questions: [{ ...fork, kind: "yesno" }] };
    expect(isLegacyBrief(clarify)).toBe(false);
  });
});

describe("ответ на бриф с первой частью", () => {
  const full = [
    { questionId: SETUP_ROW.artifacts, optionIds: ["spec"] },
    { questionId: SETUP_ROW.budgetTarget, optionIds: [], own: "$25" },
    { questionId: SETUP_ROW.budgetMax, optionIds: ["o1"] },
    { questionId: "how", optionIds: ["a"] },
    { questionId: "edits", optionIds: ["row", "depth"], own: "И «Лист»" },
    { questionId: "read", optionIds: [], own: "Не совсем: без плана" },
  ];

  it("полный ответ закрывает все строки", () => {
    expect(openQuestions(brief, { briefId: brief.id, answers: full })).toEqual([]);
  });

  it("pick закрыт после касания, свой текст складывается с вариантами", () => {
    expect(openQuestions(brief, { briefId: brief.id, answers: full.map((a) => (a.questionId === "edits" ? { questionId: "edits", optionIds: [] } : a)) })).toEqual([]);
  });

  it("confirm без Да и без своего текста незакрыт", () => {
    const answers = full.map((a) => (a.questionId === "read" ? { questionId: "read", optionIds: [] } : a));
    expect(openQuestions(brief, { briefId: brief.id, answers })).toEqual(["read"]);
  });
});
