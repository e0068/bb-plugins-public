// Слой 1 — исчерпан ли лимит GitHub API и что сказать владельцу. Эффектов нет.
//
// GitHub отвечает на исчерпанный лимит 403 или 429 с `x-ratelimit-remaining: 0`
// и временем сброса в `x-ratelimit-reset` (секунды Unix). Без этого разбора
// владелец видел «reading base "main": GitHub responded HTTP 403 (API rate
// limit exceeded…)» и не знал, когда нажимать «Повторить». Текст не содержит
// «HTTP 429», поэтому слой повторов (retry.ts) считает его постоянной ошибкой
// и не тратит на повторы то, чего уже нет.

export interface RateLimitHeaders {
  status: number;
  remaining: string | null;
  reset: string | null;
}

export function rateLimitError(res: RateLimitHeaders, formatTime: (at: Date) => string): string | null {
  if ((res.status !== 403 && res.status !== 429) || res.remaining === null || Number(res.remaining) !== 0) return null;
  const reset = res.reset === null ? Number.NaN : Number(res.reset);
  return Number.isFinite(reset)
    ? `Лимит GitHub API исчерпан, сбросится в ${formatTime(new Date(reset * 1000))}`
    : "Лимит GitHub API исчерпан, сбросится в течение часа";
}
