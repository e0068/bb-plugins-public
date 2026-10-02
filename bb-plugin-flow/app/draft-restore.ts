// Черновик возвращённого брифа на новом брифе — чистые функции без React. Владелец написал в чат, не отправив
// бриф; агент прислал бриф заново, и выбор владельца ложится туда, где вопрос и вариант остались теми же: по id
// вопроса и варианта, этап — по id этапа, правки пунктов «Готово, когда» — по тексту пункта, а не по номеру.
import { criterionEditable } from "../core/budget";
import { isMulti } from "../core/answer-message";
import { rowsOf } from "../core/rows";
import { stageItems } from "../core/stages";
import type { DecisionBrief, RestoredDraft } from "../shared/contract";
import type { CriteriaDraft, Draft } from "./draft";
import { decodeDraft } from "./draft-storage";

/** Номер пункта нового брифа с тем же текстом, что у пункта `index` возвращённого; нет такого — `null`. */
const indexMap = (brief: DecisionBrief, old: readonly string[] | undefined) => {
  const texts = (brief.setup?.criteria ?? []).map(criterionEditable);
  return (index: number): number | null => {
    const at = old?.[index] === undefined ? -1 : texts.indexOf(old[index]!);
    return at < 0 ? null : at;
  };
};

const fitCriteria = (brief: DecisionBrief, criteria: CriteriaDraft, old: readonly string[] | undefined): CriteriaDraft => {
  const moved = indexMap(brief, old);
  return {
    removed: criteria.removed.flatMap((i) => moved(i) ?? []),
    edited: Object.fromEntries(
      Object.entries(criteria.edited).flatMap(([i, text]) => {
        const to = moved(Number(i));
        return to === null ? [] : [[to, text]];
      }),
    ),
    added: criteria.added,
  };
};

const fitEntries = (brief: DecisionBrief, entries: Draft["entries"]): Draft["entries"] => {
  const rows = new Map(rowsOf(brief).map((row) => [row.id, row]));
  return Object.fromEntries(
    Object.entries(entries).flatMap(([id, entry]) => {
      const row = rows.get(id);
      if (row === undefined) return [];
      const known = new Set(row.options.map((o) => o.id));
      const optionIds = entry.optionIds.filter((o) => known.has(o));
      // Пустой выбор переносится, только если он и был выбором — «ничего не включать» у вопроса с несколькими ответами.
      const kept = optionIds.length > 0 || entry.own.trim() !== "" || (entry.optionIds.length === 0 && isMulti(row));
      const picked = entry.picked?.filter((o) => known.has(o));
      return kept ? [[id, { optionIds, own: entry.own, ...(picked === undefined ? {} : { picked }) }]] : [];
    }),
  );
};

/**
 * Черновик нового брифа поверх его начального: выбор владельца из возвращённого брифа там, где он ложится.
 * Нет возвращённого или он нечитаем — начальный как есть. Место исполнения не переносится: его бриф берёт из проекта.
 */
export const withRestored = (brief: DecisionBrief, base: Draft, restored: RestoredDraft | undefined = brief.restored): Draft => {
  const old = restored === undefined ? null : decodeDraft(restored.draft);
  if (old === null) return base;
  const stageIds = new Set(stageItems(brief).map((item) => item.stage.id));
  return {
    ...base,
    entries: { ...base.entries, ...fitEntries(brief, old.entries) },
    note: old.note,
    budget: old.budget,
    stages: Object.fromEntries(Object.entries(old.stages).filter(([id]) => stageIds.has(id))),
    criteria: fitCriteria(brief, old.criteria, restored?.criteria),
    ...(brief.outcome === undefined || old.outcomeNote === undefined ? {} : { outcomeNote: old.outcomeNote }),
  };
};
