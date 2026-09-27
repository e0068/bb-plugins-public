// Вторая полоса баннера: доля занятого окна контекста, её тон по двум порогам
// владельца и отрезки полосы, на которые эти пороги её делят. Чисто, без эффектов.

/** Обычный, предупреждающий и тревожный тон заливки занятого. */
export type ContextTone = "normal" | "warn" | "alert";

/**
 * Пороги в токенах, а не в долях окна: окно у тредов разное — 200k у одной
 * модели, 1M у другой, — и один процент означал бы очень разный объём.
 */
export interface ContextThresholds {
  readonly warnTokens: number;
  readonly alertTokens: number;
}

/**
 * Значения по умолчанию объявлены здесь и читаются сервером: записанное дважды,
 * в настройке и в запасном значении, число разошлось бы молча. Это прежние 25%
 * и 40% окна в миллион токенов — тревожить надо на первой трети, задолго до конца окна.
 */
export const DEFAULT_WARN_TOKENS = 250_000;
export const DEFAULT_ALERT_TOKENS = 400_000;

export const DEFAULT_CONTEXT_THRESHOLDS: ContextThresholds = {
  warnTokens: DEFAULT_WARN_TOKENS,
  alertTokens: DEFAULT_ALERT_TOKENS,
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

const isTokenCount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Пара осмысленна, только когда жёлтый строго меньше красного, — по этому правилу сторожится и ввод. */
export const isOrderedPair = (warnTokens: number, alertTokens: number): boolean => warnTokens < alertTokens;

/**
 * Пара порогов такая, как её ввёл владелец, — либо умолчание целиком.
 * Осмысленна только пара, где жёлтый строго меньше красного; невалидную не
 * чиним и не разворачиваем, иначе полоса красится не по той подписи, которую
 * показывает. Ввод сторожит схема настройки, а это — последний рубеж на случай,
 * когда обе ручки записаны одним вызовом мимо страницы настроек.
 */
export function thresholdsOrDefault(warn: unknown, alert: unknown): ContextThresholds {
  if (!isTokenCount(warn) || !isTokenCount(alert) || !isOrderedPair(warn, alert)) return DEFAULT_CONTEXT_THRESHOLDS;
  return { warnTokens: warn, alertTokens: alert };
}

/** Тон по занятым токенам. Порог включается в свою полосу: ровно 250 000 — уже предупреждение. */
export function contextTone(usedTokens: number, thresholds: ContextThresholds): ContextTone {
  if (usedTokens >= thresholds.alertTokens) return "alert";
  if (usedTokens >= thresholds.warnTokens) return "warn";
  return "normal";
}

/** Отрезок полосы: его доля длины полосы и доля самого отрезка, залитая занятым. */
export interface ContextSegment {
  readonly size: number;
  readonly filled: number;
}

/**
 * Полоса, разрезанная порогами: граница стоит на доле «порог ÷ окно». Порог на
 * нуле или не меньше окна границы не рисует — отрезок нулевой длины не
 * отрезок. Занятое раскладывается по отрезкам слева направо, так что заливка
 * в сумме равна доле занятого окна. Окно не положительное — полосы нет.
 */
export function contextSegments(usedTokens: number, windowTokens: number, thresholds: ContextThresholds): readonly ContextSegment[] {
  const share = contextShare(usedTokens, windowTokens);
  if (share === null) return [];
  const cuts = [thresholds.warnTokens, thresholds.alertTokens].filter((tokens) => tokens > 0 && tokens < windowTokens).map((tokens) => tokens / windowTokens);
  const edges = [0, ...cuts, 1];
  return edges.slice(1).map((end, index) => {
    const start = edges[index]!;
    return { size: end - start, filled: clamp((share - start) / (end - start), 1) };
  });
}

/** Токены коротко — так же, как их пишет bb в своём «Estimated context»: 163 000 → «163k». */
export const shortTokens = (tokens: number): string => {
  if (!Number.isFinite(tokens)) return "0";
  const value = Math.max(0, Math.round(tokens));
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  return `${Number((value / 1_000_000).toFixed(1))}M`;
};
