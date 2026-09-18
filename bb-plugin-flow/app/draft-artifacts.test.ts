// @vitest-environment node
import { describe, expect, it } from "vitest";

import { answerMessageText, openQuestions } from "../core/answer-message";
import { SETUP_ROW, rowsOf } from "../core/rows";
import type { DecisionBrief } from "../shared/contract";
import { decidedCount, emptyDraft, pickOption, toAnswer } from "./draft";

const brief: DecisionBrief = {
  id: "dec_1",
  threadId: "thr_1",
  title: "Бриф",
  createdAt: "2026-09-13T00:00:00.000Z",
  kind: "brief",
  setup: {
    artifacts: [
      { id: "task", name: "Задача", state: "missing", recommended: true },
      { id: "spec", name: "Спецификация", state: "missing", recommended: false },
      { id: "prototype", name: "HTML-прототип", state: "ready", recommended: true, link: { label: "p.html", target: "p.html" } },
      { id: "plan", name: "План", state: "missing", recommended: false },
    ],
  },
  questions: [{ id: "read", question: "Так?", kind: "confirm", allowOwn: false, options: [{ id: "yes", action: "Да", recommended: true }] }],
};

const confirmed = pickOption(emptyDraft(), brief.questions[0]!, "yes");

describe("строка артефактов не обязательна", () => {
  it("без касания артефактов бриф решён и уходит без незакрытых строк", () => {
    expect(decidedCount(brief, confirmed)).toEqual({ decided: 2, total: 2 });
    expect(openQuestions(brief, toAnswer(brief, confirmed))).toEqual([]);
  });

  it("нетронутые артефакты уходят агенту как «ничего» с расхождением от рекомендации", () => {
    expect(toAnswer(brief, confirmed).answers[0]).toEqual({ questionId: SETUP_ROW.artifacts, optionIds: [] });
    expect(answerMessageText(brief, toAnswer(brief, confirmed))).toContain(
      "Артефакты — ничего (рекомендовал Задача — сделать, HTML-прототип — утвердить, выбрано ничего)",
    );
  });

  it("выбранные артефакты уходят как выбраны вместе с меткой тронутых", () => {
    const artifactsRow = rowsOf(brief).find((r) => r.id === SETUP_ROW.artifacts)!;
    const picked = pickOption(confirmed, artifactsRow, "prototype");
    expect(toAnswer(brief, picked).answers[0]).toEqual({ questionId: SETUP_ROW.artifacts, optionIds: ["prototype"], picked: ["prototype"] });
  });
});
