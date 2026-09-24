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
      { id: "api", action: "API", recommended: true, description: "…", criteria: ["Описан API"] },
      { id: "cli", action: "CLI", recommended: false, description: "…" },
    ] },
  ],
};

const answer = (answers: DecisionAnswer["answers"]): DecisionAnswer => ({ briefId: brief.id, answers, criteria: { removed: [], edited: [], added: [] } });

describe("пункты «Готово, когда» у вариантов", () => {
  it("бриф принимает пункты у варианта", () => {
    expect(decisionBriefSchema.safeParse(brief).success).toBe(true);
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

describe("пункты варианта, снятого владельцем", () => {
  const texts = (answers: DecisionAnswer["answers"], state: "live" | "struck") =>
    optionCriteria(brief, answer(answers)).filter((c) => c.state === state).map((c) => c.text);

  it("нетронутый вопрос не даёт ни живых, ни зачёркнутых пунктов", () => {
    expect(optionCriteria(brief, answer([]))).toEqual([]);
    expect(optionCriteria(brief, answer([{ questionId: "docs", optionIds: [] }]))).toEqual([]);
  });

  it("рекомендация, мимо которой владелец ответил, зачёркнута, а выбранный вариант цел", () => {
    const answers = [{ questionId: "docs", optionIds: ["site"] }];
    expect(texts(answers, "live")).toEqual(["Страница на сайте", "Ссылка из README"]);
    expect(texts(answers, "struck")).toEqual(["README описывает витрину"]);
  });

  it("свой ответ владельца — тоже ответ: рекомендация мимо него зачёркнута", () => {
    expect(texts([{ questionId: "docs", optionIds: [], own: "сделаем иначе" }], "struck")).toEqual(["README описывает витрину"]);
  });

  it("вариант, которого агент не предлагал и владелец не выбрал, в списке не показывается", () => {
    expect(optionCriteria(brief, answer([{ questionId: "docs", optionIds: ["readme"] }])).map((c) => c.text)).toEqual(["README описывает витрину"]);
  });

  it("скрытый вопрос не даёт даже зачёркнутых пунктов: его рекомендация тоже молчит", () => {
    const shown = [{ questionId: "docs", optionIds: ["site"] }, { questionId: "depth", optionIds: ["cli"] }];
    expect(texts(shown, "struck")).toContain("Описан API");
    const hidden = [{ questionId: "docs", optionIds: ["readme"] }, { questionId: "depth", optionIds: ["cli"] }];
    expect(optionCriteria(brief, answer(hidden)).map((c) => c.text)).not.toContain("Описан API");
  });

  it("пункты снятой рекомендации агент получает как снятые, а не как отсутствующие", () => {
    const text = answerMessageText(brief, answer([{ questionId: "docs", optionIds: ["site"] }]));
    expect(text).toContain("пункты выбранных вариантов: «Страница на сайте», «Ссылка из README»");
    expect(text).toContain("снятые пункты вариантов: «README описывает витрину»");
  });

  it("владелец взял рекомендацию — строки о снятых пунктах в реплике нет", () => {
    expect(answerMessageText(brief, answer([{ questionId: "docs", optionIds: ["readme"] }]))).not.toContain("снятые пункты вариантов");
  });
});
