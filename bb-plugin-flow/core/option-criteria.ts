// Слой 1 — чисто. Пункты Definition of Done, которые приносят и снимают варианты
// ответов: выбранный вариант добавляет свои пункты и снимает пункты брифа из
// `removes`, а вариант, снятый рукой владельца, оставляет свои пункты в списке
// зачёркнутыми — отказ виден там же, где сделан, и уходит агенту словами.
// Считается по брифу и ответу, поэтому одинаково в виджете и в реплике агенту.
import type { Criterion, DecisionAnswer, DecisionBrief, DecisionOption, DecisionQuestion } from "../shared/contract";
import { hiddenQuestions } from "./visibility";

/** Пункт варианта: текст, вариант, который его принёс, и судьба пункта в списке. */
export type OptionCriterion = { questionId: string; optionId: string; text: string; state: "live" | "struck" };

/** Вариант в его судьбе: `live` — выбран, `struck` — снят владельцем, `null` — решения по нему не было. */
type Placed = { question: DecisionQuestion; option: DecisionOption; state: OptionCriterion["state"] | null };

const entryOf = (answer: Pick<DecisionAnswer, "answers">, questionId: string) => answer.answers.find((a) => a.questionId === questionId);

/**
 * Все варианты видимых вопросов с их судьбой. Зачёркивается отказ владельца, а не нетронутый бриф:
 * в вопросе уже есть ответ — выбор или свой текст, — а рекомендация агента в него не попала.
 * Вариант, которого агент не предлагал, отказом не считается: решения по нему не было, и в списке
 * он не показывается, чтобы список не рос путями, мимо которых прошли.
 */
const placedOptions = (brief: DecisionBrief, answer: Pick<DecisionAnswer, "answers">): Placed[] => {
  const hidden = hiddenQuestions(brief, answer);
  return brief.questions
    .filter((q) => !hidden.has(q.id))
    .flatMap((question) => {
      const entry = entryOf(answer, question.id);
      const chosen = entry?.optionIds ?? [];
      const answered = chosen.length > 0 || (entry?.own ?? "").trim() !== "";
      return question.options.map((option) => ({
        question,
        option,
        state: chosen.includes(option.id) ? "live" : answered && option.recommended ? "struck" : null,
      }));
    });
};

/** Пункт варианта с местом в списке: `under` — номер пункта брифа, под которым он стоит, `null` — в хвосте списка. */
export type PlacedCriterion = OptionCriterion & { under: number | null };

/**
 * Пункты вариантов в порядке брифа: у выбранных — живые, у снятых владельцем — зачёркнутые. Вариант, который снимает пункты
 * брифа, — их альтернатива и встаёт под последним снятым, а остальные — в хвост; номер за краем списка тоже уходит в хвост.
 */
export const placedOptionCriteria = (brief: DecisionBrief, answer: Pick<DecisionAnswer, "answers">): PlacedCriterion[] => {
  const count = brief.setup?.criteria?.length ?? 0;
  return placedOptions(brief, answer).flatMap(({ question, option, state }) => {
    const last = Math.max(-1, ...(option.removes ?? []));
    const under = last >= 0 && last < count ? last : null;
    return state === null ? [] : (option.criteria ?? []).map((text) => ({ questionId: question.id, optionId: option.id, text, state, under }));
  });
};

/** Пункты вариантов в порядке брифа: у выбранных — живые, у снятых владельцем — зачёркнутые. */
export const optionCriteria = (brief: DecisionBrief, answer: Pick<DecisionAnswer, "answers">): OptionCriterion[] =>
  placedOptionCriteria(brief, answer).map(({ under: _under, ...c }) => c);

/** Номера пунктов брифа, которые снимают выбранные варианты, по возрастанию и без повторов. */
export const optionRemoved = (brief: DecisionBrief, answer: Pick<DecisionAnswer, "answers">): number[] =>
  [...new Set(placedOptions(brief, answer).filter((p) => p.state === "live").flatMap(({ option }) => option.removes ?? []))].sort((a, b) => a - b);

/** Снятые пункты брифа: снятые владельцем и снятые выбранными вариантами. */
export const removedCriteria = (brief: DecisionBrief, answer: Pick<DecisionAnswer, "answers" | "criteria">): number[] =>
  [...new Set([...(answer.criteria?.removed ?? []), ...optionRemoved(brief, answer)])].sort((a, b) => a - b);

/** Название пункта брифа в итоге: правка владельца заменяет текст, у пункта-изменения — его «стало». */
const finalText = (item: Criterion, edited: string | undefined): string => {
  const title = typeof item === "string" ? item : item.text;
  if (edited === undefined) return title;
  return typeof item !== "string" && "before" in item ? `${title} — ${edited}` : edited;
};

/** Утверждённое ответом Definition of Done: оставленные пункты брифа с правками, дописанные владельцем, живые пункты выбранных вариантов. */
export const finalCriteria = (brief: DecisionBrief, answer: Pick<DecisionAnswer, "answers" | "criteria">): string[] => {
  const removed = removedCriteria(brief, answer);
  const edits = new Map((answer.criteria?.edited ?? []).map((e) => [e.index, e.text]));
  const items = (brief.setup?.criteria ?? []).flatMap((item, i) => (removed.includes(i) ? [] : [finalText(item, edits.get(i))]));
  const options = optionCriteria(brief, answer).filter((c) => c.state === "live").map((c) => c.text);
  return [...items, ...(answer.criteria?.added ?? []), ...options];
};
