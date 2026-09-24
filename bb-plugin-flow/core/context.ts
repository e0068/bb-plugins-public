// Вторая полоса баннера: доля занятого окна контекста и её тон по двум порогам
// владельца. Чисто, без эффектов.

/** Обычный, предупреждающий и тревожный тон заливки занятого. */
export type ContextTone = "normal" | "warn" | "alert";

/** Пороги в процентах — в тех единицах, в каких их вводят в настройках и показывают в подсказке. */
export interface ContextThresholds {
  readonly warnPercent: number;
  readonly alertPercent: number;
}

/**
 * Значения по умолчанию объявлены здесь и читаются сервером: записанное дважды,
 * в настройке и в запасном значении, число разошлось бы молча. Пороги низкие не
 * по ошибке — окно в миллион токенов кончается задолго до ста процентов, и
 * тревожить надо на первой трети.
 */
export const DEFAULT_WARN_PERCENT = 25;
export const DEFAULT_ALERT_PERCENT = 40;

export const DEFAULT_CONTEXT_THRESHOLDS: ContextThresholds = {
  warnPercent: DEFAULT_WARN_PERCENT,
  alertPercent: DEFAULT_ALERT_PERCENT,
};

const clamp = (value: number, max: number): number => Math.min(max, Math.max(0, value));

/**
 * Доля занятого окна в `0..1`. Окно не положительное или число не число —
 * делить не на что, и полосы не будет. Занятое сверх окна обрезается единицей:
 * полоса длиннее своей ячейки не бывает.
 */
export function contextShare(usedTokens: number, windowTokens: number): number | null {
  if (!Number.isFinite(usedTokens) || !Number.isFinite(windowTokens) || windowTokens <= 0) return null;
  return clamp(usedTokens / windowTokens, 1);
}

/** Процент занятого — та единица, в которой читается подпись и меряются пороги. */
export const contextPercent = (share: number): number => Math.round(clamp(Number.isFinite(share) ? share : 0, 1) * 100);

const onScale = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

/** Пара осмысленна, только когда жёлтый строго меньше красного, — по этому правилу сторожится и ввод. */
export const isOrderedPair = (warnPercent: number, alertPercent: number): boolean => warnPercent < alertPercent;

/**
 * Пара порогов такая, как её ввёл владелец, — либо умолчание целиком.
 * Осмысленна только пара, где жёлтый строго меньше красного; невалидную не
 * чиним и не разворачиваем, иначе полоса красится не по той подписи, которую
 * показывает. Ввод сторожит схема настройки, а это — последний рубеж на случай,
 * когда в хранилище лежит значение из прошлой версии или обе ручки записаны
 * одним вызовом мимо страницы настроек.
 */
export function thresholdsOrDefault(warn: unknown, alert: unknown): ContextThresholds {
  if (!onScale(warn) || !onScale(alert) || !isOrderedPair(warn, alert)) return DEFAULT_CONTEXT_THRESHOLDS;
  return { warnPercent: warn, alertPercent: alert };
}

/**
 * Тон по проценту занятого. Порог включается в свою полосу: ровно двадцать пять
 * процентов — уже предупреждение. Сравнивается то же число, что стоит в
 * подписи, — иначе полоса и её подпись противоречат друг другу на округлении.
 */
export function contextTone(percent: number, thresholds: ContextThresholds): ContextTone {
  if (percent >= thresholds.alertPercent) return "alert";
  if (percent >= thresholds.warnPercent) return "warn";
  return "normal";
}

/** Токены коротко — так же, как их пишет bb в своём «Estimated context»: 163 000 → «163k». */
export const shortTokens = (tokens: number): string => {
  if (!Number.isFinite(tokens)) return "0";
  const value = Math.max(0, Math.round(tokens));
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  return `${Number((value / 1_000_000).toFixed(1))}M`;
};
