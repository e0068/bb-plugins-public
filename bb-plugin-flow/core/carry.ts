// Перенос выбора владельца из брифа в бриф: исполнитель, ревью, тестирование
// и выбор по этапам работ, которые владелец сделал сам, встают в следующий бриф треда вместо
// рекомендации агента. Сервер считает перенос при приёме ответа, виджет —
// что из перенесённого ещё ложится на новый бриф.
import type { DecisionAnswer, DecisionBrief } from "../shared/contract";
import { REVIEW_ROWS, SETUP_ROW, checkerAllowed, rowsOf } from "./rows";
import { stageCarryOf } from "./stages";

export type Carried = Readonly<Record<string, readonly string[]>>;

export const CARRY_ROWS: readonly string[] = [SETUP_ROW.executor, ...REVIEW_ROWS];

/** Что уходит в следующий бриф: переносимые строки, чей вариант владелец выбрал сам, и его выбор по этапам. */
export const carryOf = (brief: DecisionBrief, answer: DecisionAnswer): Carried => {
  const inBrief = new Set(rowsOf(brief).map((row) => row.id));
  return {
    ...Object.fromEntries(
      answer.answers
        .filter((a) => CARRY_ROWS.includes(a.questionId) && inBrief.has(a.questionId) && (a.picked ?? []).some((id) => a.optionIds.includes(id)))
        .map((a) => [a.questionId, [...a.optionIds]]),
    ),
    ...stageCarryOf(brief, answer),
  };
};

/**
 * Перенос, который ложится на бриф: строка есть, варианты в ней есть, а шаг workflow у ревью и тестирования —
 * только при исполнителе workflow: перенесённом, а без переноса — рекомендованном.
 */
export const carriedFor = (brief: DecisionBrief): Carried => {
  const rows = new Map(rowsOf(brief).map((row) => [row.id, row]));
  const fits = (rowId: string, ids: readonly string[]): boolean => {
    const known = new Set(rows.get(rowId)?.options.map((o) => o.id) ?? []);
    return CARRY_ROWS.includes(rowId) && ids.length > 0 && ids.every((id) => known.has(id));
  };
  const present = Object.entries(brief.carried ?? {}).filter(([rowId, ids]) => fits(rowId, ids));
  const executorIds = Object.fromEntries(present)[SETUP_ROW.executor] ?? rows.get(SETUP_ROW.executor)?.options.filter((o) => o.recommended).map((o) => o.id);
  return Object.fromEntries(present.filter(([rowId, ids]) => !REVIEW_ROWS.includes(rowId) || ids.every((id) => checkerAllowed(executorIds, id))));
};
