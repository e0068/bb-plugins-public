// @vitest-environment node
import { describe, expect, it } from "vitest";

import { decisionBriefSchema, type DecisionAnswer, type DecisionBrief } from "../shared/contract";
import { answerMessageText } from "./answer-message";
import { optionCriteria, optionRemoved } from "./option-criteria";

const brief: DecisionBrief = {
  id: "dec_options",
  threadId: "thr_1",
  title: "Пункты у вариантов",
  createdAt: "2026-09-15T00:00:00.000Z",
  kind: "brief",
  setup: { criteria: ["Тесты зелёные", "Диаграммы в DevShell"] },
  questions: [
    { id: "docs", question: "Документация?", kind: "fork", allowOwn: false, options: [
      { id: "readme", action: "README", recommended: true, description: "…", criteria: ["README описывает витрину"], hides: ["depth"], add: { target: 0, max: 0, risk: 0 } },
      { id: "site", action: "Сайт", recommended: false, description: "…", criteria: ["Страница на сайте", "Ссылка из README"], add: { target: 2, max: 4, risk: 0 } },
      { id: "look", action: "Сначала посмотреть", recommended: false, description: "…", removes: [0, 1], add: { target: 0, max: 0, risk: 0 } },
    ] },
    { id: "depth", question: "Глубина?", kind: "pick", allowOwn: false, options: [
      { id: "api", action: "API", recommended: false, description: "…", criteria: ["Описан API"] },
      { id: "cli", action: "CLI", recommended: false, description: "…" },
    ] },
  ],
};

const answer = (answers: DecisionAnswer["answers"]): DecisionAnswer => ({ briefId: brief.id, answers, criteria: { removed: [], edited: [], added: [] } });

describe("пункты «Готово, когда» у вариантов", () => {
  it("бриф принимает пункты у варианта", () => {
    expect(decisionBriefSchema.safeParse(brief).success).toBe(true);
  });

  it("выбранный вариант добавляет свои пункты, не выбранный — нет", () => {
    expect(optionCriteria(brief, answer([{ questionId: "docs", optionIds: ["site"] }])).map((c) => c.text)).toEqual(["Страница на сайте", "Ссылка из README"]);
    expect(optionCriteria(brief, answer([{ questionId: "docs", optionIds: [] }]))).toEqual([]);
  });

  it("смена выбора убирает пункты прежнего варианта", () => {
    const texts = optionCriteria(brief, answer([{ questionId: "docs", optionIds: ["readme"] }])).map((c) => c.text);
    expect(texts).toEqual(["README описывает витрину"]);
    expect(texts).not.toContain("Страница на сайте");
  });

  it("выбор в скрытом вопросе пунктов не добавляет", () => {
    const texts = optionCriteria(brief, answer([{ questionId: "docs", optionIds: ["readme"] }, { questionId: "depth", optionIds: ["api"] }])).map((c) => c.text);
    expect(texts).not.toContain("Описан API");
  });

  it("агент получает пункты выбранных вариантов в строке «Готово, когда»", () => {
    const text = answerMessageText(brief, answer([{ questionId: "docs", optionIds: ["site"] }]));
    expect(text).toContain("пункты выбранных вариантов: «Страница на сайте», «Ссылка из README»");
    expect(text).not.toContain("README описывает витрину");
  });

  it("бриф без своих пунктов, но с пунктами выбранного варианта, называет их агенту", () => {
    const bare = { ...brief, setup: undefined };
    expect(answerMessageText(bare, answer([{ questionId: "docs", optionIds: ["readme"] }]))).toContain("Готово, когда — пункты выбранных вариантов: «README описывает витрину»");
  });

  it("выбранный вариант снимает свои пункты брифа, не выбранный возвращает их", () => {
    expect(optionRemoved(brief, answer([{ questionId: "docs", optionIds: ["look"] }]))).toEqual([0, 1]);
    expect(optionRemoved(brief, answer([{ questionId: "docs", optionIds: ["readme"] }]))).toEqual([]);
  });

  it("пункты, снятые вариантом, агент получает как снятые", () => {
    const text = answerMessageText(brief, answer([{ questionId: "docs", optionIds: ["look"] }]));
    expect(text).toContain("снят пункт 1 «Тесты зелёные»");
    expect(text).toContain("снят пункт 2 «Диаграммы в DevShell»");
  });

  it("вариант снимает только пункты брифа — чужой номер бриф не принимает", () => {
    const broken = { ...brief, questions: [{ ...brief.questions[0]!, options: [{ ...brief.questions[0]!.options[2]!, removes: [5] }] }] };
    expect(decisionBriefSchema.safeParse(broken).success).toBe(false);
  });
});
