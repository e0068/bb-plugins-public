// Pure, deterministic formatting helpers for the UI. No I/O, no locale
// lookups that could vary between renders — same input always produces the
// same string.
import type { BucketModelUsage, TokensBucket } from "./types";

/**
 * Human-readable token count: 1.4M / 30.1k / 512. Mirrors tools/tokens.py's
 * `human()` so numbers shown in the UI match numbers shown by the CLI.
 * Never throws — non-finite input is stringified as-is.
 */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}k`;
  return `${sign}${Math.trunc(abs)}`;
}

/** Formats a USD amount, e.g. 4.184 -> "$4.18". */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd)) return "$0.00";
  return `$${usd.toFixed(2)}`;
}

/**
 * Rounds an already-computed percentage (e.g. `(part / whole) * 100`) to a
 * display string, e.g. 24.6 -> "25%". Non-finite input never throws — it
 * reads as "0%". Exists so a caller that already computed the ratio for
 * another purpose (a bar segment's width, say) can format the exact same
 * number instead of recomputing it via `formatPercent` — two independent
 * computations of the same ratio is how a width and its tooltip end up
 * disagreeing when the formula changes in only one place.
 */
export function formatPercentValue(percent: number): string {
  if (!Number.isFinite(percent)) return "0%";
  return `${Math.round(percent)}%`;
}

/**
 * `part` as a percentage of `whole`, e.g. (30, 120) -> "25%". Division by
 * zero (or a non-finite whole) never throws — it reads as "0%".
 */
export function formatPercent(part: number, whole: number): string {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole === 0) {
    return "0%";
  }
  return formatPercentValue((part / whole) * 100);
}

function truncateLabel(raw: string, maxLength: number): string {
  if (raw.length <= maxLength) return raw;
  if (maxLength <= 1) return raw.slice(0, Math.max(maxLength, 0));
  return `${raw.slice(0, maxLength - 1)}…`;
}

/** Как показать один бакет: имя строкой и приглушённая подпись под ним. */
export interface BucketDisplay {
  name: string;
  caption: string | null;
}

/**
 * Модели бакета с расходом по каждой: "opus 5.7M, sonnet 52.0M, haiku 607".
 * Порядок (по убыванию расхода) приходит из считалки — см. разбор в
 * memory/decisions/token-usage-one-caption-source.md.
 */
function formatBucketModels(models: BucketModelUsage[]): string | null {
  if (models.length === 0) return null;
  return models.map(({ tier, total }) => `${tier} ${formatTokenCount(total)}`).join(", ");
}

/**
 * Как показать один бакет отчёта для любого разреза (session, project, agent,
 * workflow, model, day) — единственное место на сервере, где это
 * вычисляется; клиент рисует готовое и не выводит имя заново (см.
 * memory/decisions/token-usage-one-caption-source.md).
 *
 * Бакет с данными агента (и бакет "main" под `--by agent`) получает имя и
 * подпись агента; у остальных разрезов ключ бакета сам по себе человеческий
 * (идентификатор сессии, слаг проекта, тир модели, дата), поэтому идёт как
 * есть и подписи не имеет.
 */
export function formatBucketDisplay(bucket: TokensBucket, maxLength = 40): BucketDisplay {
  const models = formatBucketModels(bucket.models);

  const isMain = bucket.key === "main";
  if (isMain || bucket.agent) {
    const agentType = bucket.agent?.agentType ?? null;
    const raw = isMain ? "Главный агент" : (bucket.agent?.description ?? agentType ?? "Субагент");
    const name = truncateLabel(raw, maxLength);
    // Тип агента и модели с расходом — рядом: "general-purpose · sonnet 172M".
    // Тип показывается всегда, когда он есть, а не как замена имени.
    const parts = [isMain ? null : agentType, models].filter((v): v is string => Boolean(v));
    return { name, caption: parts.length > 0 ? parts.join(" · ") : null };
  }

  // Разрез по модели уже назван моделью в ключе — повторять её расход в
  // подписи значило бы написать то же число дважды.
  return { name: bucket.key, caption: null };
}

/**
 * Combined cache-write tokens (5-minute + 1-hour writes). Mirrors
 * tools/tokens.py's `Bucket.cw` property, which already computes this sum
 * internally but doesn't export it — this is the one TS-side place that
 * re-derives it, so a third cache-duration bucket added to tokens.py only
 * needs updating here, not at every call site.
 */
export function cacheWriteTotal(counts: { cacheWrite5m: number; cacheWrite1h: number }): number {
  return counts.cacheWrite5m + counts.cacheWrite1h;
}
