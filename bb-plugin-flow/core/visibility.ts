// Слой 1 — чисто. Какие вопросы брифа сняты выбором владельца: у варианта
// ответа есть пометка `hides` — вопросы, которые при нём теряют смысл. Скрытый
// вопрос не рисуется, не считается открытым и не попадает в реплику агенту.
//
// Скрывать можно только то, что ниже: один проход сверху вниз, выбор внутри
// уже скрытого вопроса ничего не скрывает, а `hides` вверх не действует. Так
// результат один и тот же у виджета и у сервера — и на полном черновике, и на
// ответе, из которого скрытые вопросы уже выброшены; взаимные `hides` не
// качаются между «скрыто всё» и «скрыто ничего».
import type { DecisionAnswer, DecisionBrief } from "../shared/contract";

export const hiddenQuestions = (brief: DecisionBrief, answer: Pick<DecisionAnswer, "answers">): ReadonlySet<string> => {
  const chosen = new Map(answer.answers.map((a) => [a.questionId, a.optionIds]));
  const position = new Map(brief.questions.map((q, i) => [q.id, i]));
  return brief.questions.reduce<ReadonlySet<string>>((hidden, question, i) => {
    if (hidden.has(question.id)) return hidden;
    const below = question.options
      .filter((o) => (chosen.get(question.id) ?? []).includes(o.id))
      .flatMap((o) => o.hides ?? [])
      .filter((id) => (position.get(id) ?? -1) > i);
    return below.length === 0 ? hidden : new Set([...hidden, ...below]);
  }, new Set());
};
