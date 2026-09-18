// Слой 1 — чисто. Пункты «Готово, когда», которые приносят и снимают варианты
// ответов: выбранный вариант добавляет свои пункты и снимает пункты брифа из
// `removes`, снятый выбор всё возвращает, выбор в скрытом вопросе не действует.
// Считается по брифу и ответу, поэтому одинаково в виджете и в реплике агенту.
import type { DecisionAnswer, DecisionBrief, DecisionOption, DecisionQuestion } from "../shared/contract";
import { hiddenQuestions } from "./visibility";

/** Пункт варианта: текст и вариант, который его принёс. */
export type OptionCriterion = { questionId: string; optionId: string; action: string; text: string };

const chosenOptions = (brief: DecisionBrief, answer: Pick<DecisionAnswer, "answers">): Array<{ question: DecisionQuestion; option: DecisionOption }> => {
  const hidden = hiddenQuestions(brief, answer);
  const chosen = new Map(answer.answers.map((a) => [a.questionId, a.optionIds]));
  return brief.questions
    .filter((q) => !hidden.has(q.id))
    .flatMap((question) => question.options.filter((o) => (chosen.get(question.id) ?? []).includes(o.id)).map((option) => ({ question, option })));
};

export const optionCriteria = (brief: DecisionBrief, answer: Pick<DecisionAnswer, "answers">): OptionCriterion[] =>
  chosenOptions(brief, answer).flatMap(({ question, option }) =>
    (option.criteria ?? []).map((text) => ({ questionId: question.id, optionId: option.id, action: option.action, text })),
  );

/** Номера пунктов брифа, которые снимают выбранные варианты, по возрастанию и без повторов. */
export const optionRemoved = (brief: DecisionBrief, answer: Pick<DecisionAnswer, "answers">): number[] =>
  [...new Set(chosenOptions(brief, answer).flatMap(({ option }) => option.removes ?? []))].sort((a, b) => a - b);

/** Снятые пункты брифа: снятые владельцем и снятые выбранными вариантами. */
export const removedCriteria = (brief: DecisionBrief, answer: Pick<DecisionAnswer, "answers" | "criteria">): number[] =>
  [...new Set([...(answer.criteria?.removed ?? []), ...optionRemoved(brief, answer)])].sort((a, b) => a - b);
