// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { answerMessageText, openQuestions } from "./answer-message";
import { SETUP_ROW } from "./rows";

const brief: DecisionBrief = {
  id: "dec_c",
  threadId: "thr_1",
  createdAt: "2026-09-13T00:00:00.000Z",
  title: "Критерий",
  kind: "brief",
  setup: { criteria: ["Пункты с крестом", "Черновик сохраняется", "Порядок артефактов"] },
  questions: [],
};

const answer = (criteria?: DecisionAnswer["criteria"]): DecisionAnswer => ({ briefId: brief.id, answers: [], ...(criteria ? { criteria } : {}) });

describe("реплика агенту о критерии", () => {
  it("без правок — одна строка, что пункты оставлены", () => {
    expect(answerMessageText(brief, answer({ removed: [], edited: [], added: [] }))).toContain("Готово, когда — без правок, пунктов: 3");
    expect(answerMessageText(brief, answer())).toContain("Готово, когда — без правок, пунктов: 3");
  });

  it("снятый, переписанный и добавленный пункт названы номером и текстом", () => {
    const text = answerMessageText(brief, answer({ removed: [2], edited: [{ index: 0, text: "Пункты с крестом справа" }], added: ["Тесты зелёные"] }));
    expect(text).toContain("снят пункт 3 «Порядок артефактов»");
    expect(text).toContain("переписан пункт 1 — «Пункты с крестом справа»");
    expect(text).toContain("добавлен пункт «Тесты зелёные»");
  });

  it("у брифа без критерия строки нет", () => {
    expect(answerMessageText({ ...brief, setup: undefined }, answer())).not.toContain("Готово, когда");
  });
});

describe("ответ с чужими пунктами не принимается", () => {
  it("номер за пределами списка, снятый и переписанный сразу, критерий у брифа без критерия", () => {
    expect(openQuestions(brief, answer({ removed: [3], edited: [], added: [] }))).toEqual([SETUP_ROW.criteria]);
    expect(openQuestions(brief, answer({ removed: [1], edited: [{ index: 1, text: "Иначе" }], added: [] }))).toEqual([SETUP_ROW.criteria]);
    expect(openQuestions({ ...brief, setup: undefined }, answer({ removed: [], edited: [], added: ["Пункт"] }))).toEqual([SETUP_ROW.criteria]);
  });

  it("правки в пределах списка ответ не держат", () => {
    expect(openQuestions(brief, answer({ removed: [0, 2], edited: [{ index: 1, text: "Иначе" }], added: ["Ещё"] }))).toEqual([]);
  });
});
