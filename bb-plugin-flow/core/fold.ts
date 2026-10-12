// Слой 1 — чисто. Группа треда — виджеты после прошлого утверждения до ближайшего утверждения включительно — и
// выбор владельца в ней: комментарий к утверждению сворачивает группу, а выбор из неё ложится на новые виджеты.
import type { DecisionAnswer, DecisionBrief, RestoredDraft, RestoredSource, ThreadGroup } from "../shared/contract";
import { awaitingKind } from "./awaiting";
import { criterionEditable } from "./budget";

/** Утверждение — итог этапа вида approve: ждёт кнопку владельца, а его комментарий возвращает агенту всю группу. */
export const isApproval = (brief: DecisionBrief): boolean => awaitingKind(brief) === "approve";

/**
 * Список группы треда после нового брифа. Прошлый последний бриф — утверждение: группа закрыта, список начинается
 * с нового; иначе id дописывается. Свёртка сбрасывается новым виджетом, кроме уточнения: оно утверждению не доработка,
 * и запрет присылать утверждение вслед за свёрнутым остаётся.
 */
export const nextGroup = (group: ThreadGroup | null, brief: DecisionBrief): ThreadGroup => ({
  ids: group === null || group.lastApprove ? [brief.id] : [...group.ids, brief.id],
  lastApprove: isApproval(brief),
  folded: brief.kind === "clarify" && group !== null ? group.folded : false,
});

/** Что известно о виджете свёрнутой группы: сам бриф (его нет — нечитаем), ответ и черновик владельца. */
export type Member = { brief: DecisionBrief | null; answer: DecisionAnswer | null; draft: string | null };

/** Источники из записи выбора: старая запись одного виджета — последний источник, после списка. */
export const restoredSources = (restored: RestoredDraft): RestoredSource[] => [
  ...(restored.sources ?? []),
  ...(restored.draft === undefined ? [] : [{ draft: restored.draft, ...(restored.criteria === undefined ? {} : { criteria: restored.criteria }) }]),
];

/**
 * Выбор владельца в виджете группы: ответ, а у неотвеченного — черновик; нетронутый виджет несёт выбор, который сам принёс.
 * Тексты пунктов нужны, чтобы правки пунктов легли на новый бриф по тексту, а не по номеру.
 */
export const memberSources = ({ brief, answer, draft }: Member): RestoredSource[] => {
  const criteria = brief?.setup?.criteria?.map(criterionEditable);
  const texts = criteria === undefined ? {} : { criteria };
  if (answer !== null) return [{ answer, ...texts }];
  if (draft !== null) return [{ draft, ...texts }];
  return brief?.restored === undefined ? [] : restoredSources(brief.restored);
};

/** Запись выбора для нового брифа; источников нет — записи нет. Поле `draft` записи остаётся только для чтения брифов, записанных раньше. */
export const restoredOf = (sources: readonly RestoredSource[]): RestoredDraft | undefined => (sources.length === 0 ? undefined : { sources: [...sources] });
