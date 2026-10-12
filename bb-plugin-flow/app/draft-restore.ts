// Выбор владельца из свёрнутых виджетов на новом виджете — чистые функции без React. Владелец написал в чат или
// прокомментировал утверждение; агент прислал виджеты заново, и выбор владельца ложится туда, где вопрос и вариант
// остались теми же: по id вопроса и варианта, этап — по id этапа, правки пунктов Definition of Done — по тексту пункта,
// а не по номеру. Источников несколько — по одному на виджет свёрнутой группы, от старого к новому: поздний ложится поверх раннего.
import { criterionEditable } from "../core/budget";
import { isMulti } from "../core/answer-message";
import { restoredSources } from "../core/fold";
import { rowsOf } from "../core/rows";
import { stageItems } from "../core/stages";
import type { DecisionBrief, RestoredDraft, RestoredSource } from "../shared/contract";
import { fromAnswer, initialDraft, type CriteriaDraft, type Draft } from "./draft";
import { decodeDraft } from "./draft-storage";

/** Номер пункта нового брифа с тем же текстом, что у пункта `index` возвращённого; нет такого — `null`. */
const indexMap = (brief: DecisionBrief, old: readonly string[] | undefined) => {
  const texts = (brief.setup?.criteria ?? []).map(criterionEditable);
  return (index: number): number | null => {
    const at = old?.[index] === undefined ? -1 : texts.indexOf(old[index]!);
    return at < 0 ? null : at;
  };
};

/**
 * Правки пунктов источника поверх прежних. Источник, знающий пункт, говорит о нём последним словом: прежняя правка
 * этого пункта снимается, а его собственная — вычёркивание или новый текст — ложится. Свои пункты владельца не повторяются.
 */
const mergeCriteria = (brief: DecisionBrief, prior: CriteriaDraft, criteria: CriteriaDraft, old: readonly string[] | undefined): CriteriaDraft => {
  const moved = indexMap(brief, old);
  const covered = (old ?? []).flatMap((_, index) => moved(index) ?? []);
  const kept = (index: number) => !covered.includes(index);
  return {
    removed: [...prior.removed.filter(kept), ...criteria.removed.flatMap((i) => moved(i) ?? [])],
    edited: {
      ...Object.fromEntries(Object.entries(prior.edited).filter(([i]) => kept(Number(i)))),
      ...Object.fromEntries(
        Object.entries(criteria.edited).flatMap(([i, text]) => {
          const to = moved(Number(i));
          return to === null ? [] : [[to, text]];
        }),
      ),
    },
    added: [...new Set([...prior.added, ...criteria.added])],
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

/** Выбор владельца в источнике: черновик строкой или записанный ответ; нечитаемый — `null`. */
const draftOf = (source: RestoredSource): Draft | null => (source.draft !== undefined ? decodeDraft(source.draft) : source.answer === undefined ? null : fromAnswer(source.answer));

const isBlank = (budget: Draft["budget"]): boolean => Object.values(budget).every((text) => text.trim() === "");

/**
 * Черновик нового брифа поверх его начального: выбор владельца из свёрнутых виджетов там, где он ложится; поздний
 * источник главнее раннего, а пустой текст и пустая цена позднего прежние не стирают.
 * Нет читаемых источников — начальный как есть. Место исполнения не переносится: его бриф берёт из проекта.
 */
export const withRestored = (brief: DecisionBrief, base: Draft, restored: RestoredDraft | undefined = brief.restored): Draft => {
  const stageIds = new Set(stageItems(brief).map((item) => item.stage.id));
  const sources = (restored === undefined ? [] : restoredSources(restored)).flatMap((source) => {
    const old = draftOf(source);
    return old === null ? [] : [{ old, criteria: source.criteria }];
  });
  return sources.reduce(
    (draft, { old, criteria }): Draft => ({
      ...draft,
      entries: { ...draft.entries, ...fitEntries(brief, old.entries) },
      note: old.note === "" ? draft.note : old.note,
      budget: isBlank(old.budget) ? draft.budget : old.budget,
      stages: { ...draft.stages, ...Object.fromEntries(Object.entries(old.stages).filter(([id]) => stageIds.has(id))) },
      criteria: mergeCriteria(brief, draft.criteria, old.criteria, criteria),
      ...(brief.outcome === undefined || old.outcomeNote === undefined ? {} : { outcomeNote: old.outcomeNote }),
      ...(brief.outcome?.nextFlow === undefined || old.outcomeFlow === undefined ? {} : { outcomeFlow: old.outcomeFlow }),
    }),
    base,
  );
};

/**
 * Что владелец видел в неотвеченном виджете свёрнутой группы: его черновик с сервера; черновика нет или он нечитаем —
 * начальный вид виджета, то есть рекомендации агента и выбор, который виджет принёс из прежней группы.
 */
export const shownDraft = (brief: DecisionBrief, raw: string | undefined): Draft => (raw === undefined ? null : decodeDraft(raw)) ?? withRestored(brief, initialDraft(brief));
