// Черновик брифа в localStorage окна по id брифа: виджет размонтируется при
// переходе в другой тред или плагин, а выбор и набранный текст должны его
// пережить. Разбор не доверяет записи: чужой или битый формат — нет черновика.
import { ROUTE_BRANCHES, ROUTE_TREES } from "../core/places";
import type { DispatchPlace, DispatchRoute } from "../shared/contract";
import { emptyBudget, emptyCriteria, type CriteriaDraft, type Draft } from "./draft";

const KEY_PREFIX = "decisions:draft:";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === "string");
const isIndexes = (value: unknown): value is number[] => Array.isArray(value) && value.every((v) => Number.isInteger(v) && v >= 0);

const isEntry = (value: unknown): value is Draft["entries"][string] =>
  isRecord(value) && isStrings(value.optionIds) && typeof value.own === "string";

const readCriteria = (value: unknown): CriteriaDraft | null => {
  // Черновик, записанный до пунктов критерия, читается с нетронутым критерием.
  if (value === undefined) return emptyCriteria();
  if (!isRecord(value) || !isIndexes(value.removed) || !isStrings(value.added) || !isRecord(value.edited)) return null;
  const edited = Object.entries(value.edited);
  if (!edited.every(([k, v]) => /^\d+$/.test(k) && typeof v === "string")) return null;
  return { removed: value.removed, added: value.added, edited: Object.fromEntries(edited.map(([k, v]) => [Number(k), v as string])) };
};

const PLACES: readonly DispatchPlace[] = ["here", "thread", "worktree"];

const isRoute = (value: unknown): value is DispatchRoute =>
  isRecord(value) && (ROUTE_TREES as readonly unknown[]).includes(value.tree) && (ROUTE_BRANCHES as readonly unknown[]).includes(value.branch);

/** Выбор места и Демонстрации: поле чужого вида отбрасывается, черновик остаётся. */
const readChoices = (value: Record<string, unknown>): Pick<Draft, "place" | "route" | "outcomeNote" | "outcomeRework"> => ({
  ...((PLACES as readonly unknown[]).includes(value.place) ? { place: value.place as DispatchPlace } : {}),
  ...(isRoute(value.route) ? { route: value.route } : {}),
  ...(typeof value.outcomeNote === "string" ? { outcomeNote: value.outcomeNote } : {}),
  ...(typeof value.outcomeRework === "boolean" ? { outcomeRework: value.outcomeRework } : {}),
});

export const encodeDraft = (draft: Draft): string => JSON.stringify(draft);

export const decodeDraft = (raw: string): Draft | null => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || !isRecord(value.entries) || typeof value.note !== "string") return null;
  if (!Object.values(value.entries).every(isEntry)) return null;
  const criteria = readCriteria(value.criteria);
  // Черновик, записанный до своей цены, читается с прогнозом.
  const budget = value.budget === undefined ? emptyBudget() : isRecord(value.budget) && typeof value.budget.target === "string" && typeof value.budget.max === "string" ? { target: value.budget.target, max: value.budget.max } : null;
  // Черновик, записанный до этапов, читается без выбора по этапам; чужая форма этапов — нет черновика.
  const stages = value.stages === undefined ? {} : isRecord(value.stages) && Object.values(value.stages).every(isRecord) ? (value.stages as Draft["stages"]) : null;
  return criteria === null || budget === null || stages === null ? null : { entries: value.entries as Draft["entries"], note: value.note, criteria, budget, stages, ...readChoices(value) };
};

// localStorage бывает недоступен или переполнен: черновик — удобство, падать из-за него нельзя.
const storage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const attempt = (effect: () => void): void => {
  try {
    effect();
  } catch {
    // запись не удалась — черновик просто не переживёт уход
  }
};

export const readStoredDraft = (briefId: string): Draft | null => {
  const raw = storage()?.getItem(`${KEY_PREFIX}${briefId}`) ?? null;
  return raw === null ? null : decodeDraft(raw);
};

export const storeDraft = (briefId: string, draft: Draft): void =>
  attempt(() => storage()?.setItem(`${KEY_PREFIX}${briefId}`, encodeDraft(draft)));

export const clearStoredDraft = (briefId: string): void => attempt(() => storage()?.removeItem(`${KEY_PREFIX}${briefId}`));
