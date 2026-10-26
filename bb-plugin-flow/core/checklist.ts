// Слой 1 — чисто. «Продолжить с правками» с комментариями к виджетам заводит чек-лист: пункт на комментарий. Агент выполняет пункты,
// отмечает их инструментом и только потом начинает следующий этап — уже без нового утверждения.
import type { ChecklistItem } from "../shared/contract";

export const CHECKLIST_TOOL = "flow_checklist";

/** Пункты из комментариев владельца: пустой комментарий пункта не даёт, номера — по порядку виджетов. */
export const checklistOf = (comments: ReadonlyArray<{ where: string; text: string | undefined }>): ChecklistItem[] =>
  comments.flatMap((c) => (c.text === undefined || c.text.trim() === "" ? [] : [{ where: c.where, text: c.text.trim() }])).map((c, i) => ({ id: `c${i + 1}`, ...c, done: false }));

export const openItems = (items: readonly ChecklistItem[]): ChecklistItem[] => items.filter((item) => !item.done);

/** Отметка агента: названные пункты выполнены; незнакомые id — в `unknown`, чтобы агент увидел опечатку. */
export const tick = (items: readonly ChecklistItem[], ids: readonly string[]): { items: ChecklistItem[]; unknown: string[] } => ({
  items: items.map((item) => (ids.includes(item.id) ? { ...item, done: true } : item)),
  unknown: ids.filter((id) => !items.some((item) => item.id === id)),
});

const itemLine = (item: ChecklistItem): string => `- ${item.id} [${item.done ? "x" : " "}] ${item.where}: ${item.text}`;

/** Чек-лист агенту в ответе Утверждения: пункты с id и что с ними делать. */
export const checklistRule = (items: readonly ChecklistItem[]): string =>
  [
    `Checklist from the owner's comments on the widgets — the approval stands, no new approval is needed. Do every item, mark each done with ${CHECKLIST_TOOL} as you finish it; the next stage starts only when all are done. If an item is unclear, go back to the Questions stage with a question instead.`,
    ...items.map(itemLine),
  ].join("\n");

/** Отказ отметке следующего этапа, пока чек-лист открыт. */
export const checklistBlock = (items: readonly ChecklistItem[]): string =>
  [`The checklist from the owner's comments is not done: finish these items and mark them with ${CHECKLIST_TOOL} first. Nothing was marked.`, ...openItems(items).map(itemLine)].join("\n");
