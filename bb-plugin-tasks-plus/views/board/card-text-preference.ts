import { isRecord, oneOf, perBoardStore } from "./per-board-store.js";

/**
 * The type sizes of a board's cards — the title's and the description's —
 * one pair per board, in the browser profile, apart from the board layout
 * like the chart settings: a size is not a filter.
 */
export const CARD_TEXT_STORAGE_KEY = "bb-tasks:board-card-text";

export const TITLE_SIZES = ["s", "m", "l"] as const;
export type TitleSize = (typeof TITLE_SIZES)[number];

export const DESCRIPTION_SIZES = ["xs", "s", "m"] as const;
export type DescriptionSize = (typeof DESCRIPTION_SIZES)[number];

export interface CardTextPreference {
  title: TitleSize;
  description: DescriptionSize;
}

/** What a card drew before the sizes were a choice: a 13 px title over an 11 px description. */
export const DEFAULT_CARD_TEXT: CardTextPreference = { title: "m", description: "xs" };

/**
 * Each size's type class on bb's scale — 2xs 11, xs 12, sm 13, base 15 px on
 * the desktop. A large title sits halfway between sm and base, 14 px there,
 * so it stays between them on any scale bb switches to.
 */
export const TITLE_SIZE_CLASS: Record<TitleSize, string> = {
  s: "text-xs",
  m: "text-sm",
  l: "text-[length:calc((var(--text-sm)+var(--text-base))/2)]",
};
export const DESCRIPTION_SIZE_CLASS: Record<DescriptionSize, string> = { xs: "text-2xs", s: "text-xs", m: "text-sm" };

/** Any stored value as a whole preference, each size falling back on its own. */
export function parseCardText(raw: unknown): CardTextPreference {
  const record = isRecord(raw) ? raw : {};
  return {
    title: oneOf(TITLE_SIZES, record.title, DEFAULT_CARD_TEXT.title),
    description: oneOf(DESCRIPTION_SIZES, record.description, DEFAULT_CARD_TEXT.description),
  };
}

const store = perBoardStore(CARD_TEXT_STORAGE_KEY, parseCardText);

export const loadCardText = store.load;
export const setCardText = store.set;
/** Reactive card type sizes of one board. */
export const useCardText = store.use;
