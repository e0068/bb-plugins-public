// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionBrief } from "../shared/contract";
import { answerMessageText, deviations } from "./answer-message";
import { rowsOf, SETUP_ROW } from "./rows";

// Бриф, записанный до отзыва утверждений: без метки `revocable`, которую сервер ставит новым брифам.
const old: DecisionBrief = {
  id: "dec_old",
  threadId: "thr_1",
  title: "Старый бриф",
  createdAt: "2026-09-12T00:00:00.000Z",
  kind: "brief",
  setup: {
    artifacts: [
      { id: "task", name: "Задача", state: "approved", recommended: false, link: { label: "SL-1", target: "t.md" } },
      { id: "spec", name: "Спека", state: "missing", recommended: true },
    ],
  },
  questions: [],
};

const answer = { briefId: old.id, answers: [{ questionId: SETUP_ROW.artifacts, optionIds: ["spec"] }] };

describe("бриф, записанный до отзыва утверждений", () => {
  it("утверждённый артефакт не входит в строку артефактов", () => {
    expect(rowsOf(old)[0]?.options.map((o) => o.id)).toEqual(["spec"]);
  });

  it("старый ответ читается без расхождений и без отзыва утверждения", () => {
    expect(deviations(old, answer)).toBe(0);
    expect(answerMessageText(old, answer)).not.toContain("отозвать утверждение");
  });

  it("бриф с меткой revocable держит утверждённый в строке", () => {
    expect(rowsOf({ ...old, revocable: true })[0]?.options.map((o) => o.id)).toEqual(["task", "spec"]);
  });
});
