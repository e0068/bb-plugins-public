// Слой 1 — чистое ядро: скрытый слот композера. Ни эффектов, ни SDK.
//
// Слот — это черновик, которого ещё не видно: он адресуется композером, а не
// местом в списке, и переписывается по ходу набора. Видимым он становится
// ровно тогда, когда его штамп запуска не совпадает с текущим: бэкенд плагина
// живёт столько же, сколько хост bb, поэтому чужой штамп означает, что
// приложение умерло вместе с набранным, а композер свой текст потерял.
import { type Draft, type DraftList, type Place } from "./drafts";

export interface Slot {
  /** Текст композера как есть, с разметкой форматирования. */
  readonly text: string;
  readonly place: Place;
  readonly savedAt: number;
  /** Запуск бэкенда, в котором слот записан. */
  readonly session: string;
}

/** Слоты по адресам композеров: на композер — ровно один слот. */
export type SlotMap = Readonly<Record<string, Slot>>;

/**
 * Адрес композера. Берётся из места, а не из области композера: по тому же
 * адресу опознаётся и всплывшая карточка — у неё место то же самое.
 */
export const composerKey = (place: Pick<Place, "threadId" | "projectId">): string =>
  place.threadId !== null ? `thread:${place.threadId}` : `home:${place.projectId ?? ""}`;

const isAuto = (draft: Draft): boolean => draft.auto === true;

/**
 * Запись слота или гашение при `null`. Карта возвращается той же ссылкой,
 * если писать нечего: сервер по ссылке решает, трогать ли хранилище.
 */
export function writeSlot(slots: SlotMap, key: string, slot: Slot | null): SlotMap {
  const current = slots[key];
  if (slot === null) {
    if (current === undefined) return slots;
    const { [key]: _gone, ...rest } = slots;
    return rest;
  }
  if (current !== undefined && current.text === slot.text && current.session === slot.session) return slots;
  return { ...slots, [key]: slot };
}

export interface Promotion {
  readonly slots: SlotMap;
  readonly drafts: DraftList;
}

/**
 * Всплытие: слоты чужого запуска уходят из карты и встают в начало списка
 * авто-черновиками, новыми вперёд. Черновик лепит `mint` — id и время
 * рождаются в оболочке, ядро остаётся чистым.
 */
export function promoteStale(slots: SlotMap, list: DraftList, session: string, mint: (slot: Slot) => Draft): Promotion {
  const stale = Object.entries(slots).filter(([, slot]) => slot.session !== session);
  if (stale.length === 0) return { slots, drafts: list };
  const promoted = [...stale]
    .sort(([, left], [, right]) => right.savedAt - left.savedAt)
    .map(([, slot]) => mint(slot));
  const kept = Object.fromEntries(Object.entries(slots).filter(([, slot]) => slot.session === session));
  return { slots: kept, drafts: [...promoted, ...list] };
}

/**
 * Композер забирает свою всплывшую карточку обратно: если bb сам вернул текст
 * в композер, карточка — двойник живого текста. Сохранённое рукой не трогается
 * никогда, даже при совпадении текста.
 */
export function reclaimAuto(list: DraftList, key: string, text: string): DraftList {
  const next = list.filter((draft) => !(isAuto(draft) && draft.text === text && composerKey(draft.place) === key));
  return next.length === list.length ? list : next;
}
