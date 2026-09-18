// Слой 1 — чистое ядро: настройки плагина из недоверенных значений хоста.

/**
 * Размер текста карточки. Шаги — шкала bb: `default` это её `sm` (13 px),
 * `small` — `xs` (12 px), `smallest` — `2xs` (11 px), размер подписи места.
 */
export type CardTextSize = "default" | "small" | "smallest";

/**
 * Подписи вариантов настройки, от крупного к мелкому. Настройка типа `select`
 * хранит подпись выбранного варианта, а не код, поэтому список — источник и
 * для объявления настройки, и для разбора её значения.
 */
export const CARD_TEXT_OPTIONS = ["Default — 13 px", "Small — 12 px", "Smallest — 11 px"] as const;

const CARD_TEXT_SIZES: readonly CardTextSize[] = ["default", "small", "smallest"];

export interface Settings {
  readonly cardLines: number;
  readonly cardWidth: number;
  readonly showInThreads: boolean;
  readonly autosave: boolean;
  readonly cardTextSize: CardTextSize;
}

export const DEFAULT_SETTINGS: Settings = {
  cardLines: 6,
  cardWidth: 240,
  showInThreads: true,
  autosave: true,
  cardTextSize: "default",
};

export const SETTING_BOUNDS = {
  cardLines: { min: 1, max: 20 },
  cardWidth: { min: 160, max: 480 },
} as const;

function clampedInt(value: unknown, fallback: number, { min, max }: { min: number; max: number }): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

const bool = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

function cardTextSize(value: unknown): CardTextSize {
  const index = CARD_TEXT_OPTIONS.indexOf(value as (typeof CARD_TEXT_OPTIONS)[number]);
  return index === -1 ? DEFAULT_SETTINGS.cardTextSize : CARD_TEXT_SIZES[index]!;
}

export function parseSettings(values: Readonly<Record<string, unknown>> | undefined): Settings {
  const source = values ?? {};
  return {
    cardLines: clampedInt(source.cardLines, DEFAULT_SETTINGS.cardLines, SETTING_BOUNDS.cardLines),
    cardWidth: clampedInt(source.cardWidth, DEFAULT_SETTINGS.cardWidth, SETTING_BOUNDS.cardWidth),
    showInThreads: bool(source.showInThreads, DEFAULT_SETTINGS.showInThreads),
    autosave: bool(source.autosave, DEFAULT_SETTINGS.autosave),
    cardTextSize: cardTextSize(source.cardTextSize),
  };
}
