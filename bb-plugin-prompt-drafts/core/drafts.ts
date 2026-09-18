// Слой 1 — чистое ядро: список черновиков, обмен с композером и то, какие
// карточки видны на Home и в треде. Ни эффектов, ни SDK — только данные.

/**
 * Сигнал сервера «список изменился». Живёт в ядре, а не в server.ts: фронт
 * не должен импортировать значения из сервера, иначе в бандл едет бэкенд.
 */
export const DRAFTS_CHANGED = "drafts-changed";

/** Где сохранён черновик: снимок на момент сохранения, а не живые данные. */
export interface Place {
  readonly threadId: string | null;
  readonly threadTitle: string | null;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly worktree: string | null;
  readonly branch: string | null;
}

export interface Draft {
  readonly id: string;
  /** Текст композера как есть, с разметкой форматирования. */
  readonly text: string;
  readonly createdAt: number;
  readonly place: Place;
  /** Черновик всплыл из скрытого слота, а не сохранён рукой. */
  readonly auto?: boolean;
}

/** Черновики новыми вперёд. */
export type DraftList = readonly Draft[];

export interface Swap {
  readonly list: DraftList;
  /** Снятый черновик; null, если id неизвестен. */
  readonly taken: Draft | null;
}

export const isBlank = (text: string): boolean => text.trim() === "";

export const addDraft = (list: DraftList, draft: Draft): DraftList => [draft, ...list];

export const removeDraft = (list: DraftList, id: string): DraftList => list.filter((item) => item.id !== id);

/**
 * Снимает черновик и ставит замену на его место: так содержимое композера,
 * ушедшее в черновик, оказывается там, куда пользователь только что кликнул.
 */
export function swapDraft(list: DraftList, id: string, replacement: Draft | null): Swap {
  const index = list.findIndex((item) => item.id === id);
  if (index === -1) return { list, taken: null };
  const rest = replacement === null ? [] : [replacement];
  return { list: [...list.slice(0, index), ...rest, ...list.slice(index + 1)], taken: list[index]! };
}

const isThreadDraft = (item: Draft): boolean => item.place.threadId !== null;

/** Home при включённой настройке показывает только черновики вне тредов. */
export const homeCards = (list: DraftList, showInThreads: boolean): DraftList =>
  showInThreads ? list.filter((item) => !isThreadDraft(item)) : list;

/** Над композером треда — только черновики этого треда; при выключенной настройке — ничего. */
export const threadCards = (list: DraftList, threadId: string, showInThreads: boolean): DraftList =>
  showInThreads ? list.filter((item) => item.place.threadId === threadId) : [];
