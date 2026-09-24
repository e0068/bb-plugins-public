import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { openQuestions } from "./answer-message";

const brief: DecisionBrief = {
  id: "dec_1",
  threadId: "thr_1",
  title: "HTML-прототип готов",
  createdAt: "2026-09-16T10:00:00.000Z",
  kind: "brief",
  questions: [],
  outcome: {
    stage: "prototype",
    final: false,
    next: "Спецификация",
    done: ["Место исполнения слева от «Отправить»"],
    pending: [{ text: "Итог этапа — одна секция", why: "делаю следующим шагом" }],
    results: [{ label: "prototype.html", target: "docs/assets/x/prototype.html" }],
  },
  stages: { list: [{ id: "prototype", skill: "prototype", name: "HTML-прототип", review: true, executors: [] }], minButtonWidth: 160 },
};

const answer = (outcome?: DecisionAnswer["outcome"]): DecisionAnswer => ({ briefId: "dec_1", answers: [], ...(outcome === undefined ? {} : { outcome }) });

describe("полнота ответа на итог этапа", () => {
  it("нетронутый итог держит бриф неполным", () => {
    expect(openQuestions(brief, answer())).toEqual(["outcome"]);
  });

  it("«Продолжить» закрывает бриф", () => {
    expect(openQuestions(brief, answer({ accepted: true }))).toEqual([]);
  });

  it("свой ответ закрывает бриф", () => {
    expect(openQuestions(brief, answer({ accepted: false, note: "переделай подпись" }))).toEqual([]);
  });

  it("ответ на итог в брифе без итога — чужой", () => {
    const plain: DecisionBrief = { ...brief, outcome: undefined, setup: { criteria: ["Тесты зелёные"] } };
    expect(openQuestions(plain, answer({ accepted: true }))).toEqual(["outcome"]);
  });
});

