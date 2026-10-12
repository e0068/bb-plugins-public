// Слой 1 — чисто. Уточнение — вопросы без остановки работы; одна строка «да/нет» отвечается нажатием, любые другие вопросы
// рисуются формой брифа.
import type { DecisionAnswer, DecisionBrief } from "../shared/contract";

/** Уточнение из одного вопроса да/нет: отвечается одним нажатием, без кнопки отправки. */
export const isQuickClarify = (brief: Pick<DecisionBrief, "kind" | "questions">): boolean =>
  brief.kind === "clarify" && brief.questions.length === 1 && brief.questions[0]?.kind === "yesno";

/**
 * Ответ на уточнение приходит в идущий ход: агент не стоит, поэтому место, сжатие, переход в другой flow и исполнитель
 * у него снимаются — иначе ответ посреди хода сжал бы контекст или запустил вторую копию работы в новом треде.
 */
export const settleClarifyAnswer = (brief: Pick<DecisionBrief, "kind">, answer: DecisionAnswer): DecisionAnswer => {
  if (brief.kind !== "clarify") return answer;
  const { place: _place, route: _route, compact: _compact, flow: _flow, execution: _execution, outcome: _outcome, ...kept } = answer;
  return kept;
};
