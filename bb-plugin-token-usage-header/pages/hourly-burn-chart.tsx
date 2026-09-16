// Hourly token-burn bar chart for the "Usage Analytics" summary block
// (UsageProjectsSummary.tsx) — one column per hour of the selected D/W/M
// window, height proportional to that hour's token total. Deliberately not
// built on ThreadRow (thread-chart.tsx): that component draws one THREAD's
// per-agent stacked segments with a rich hover tooltip and git markers —
// this chart has none of that, it's a single aggregate series across every
// thread in the window, so a dedicated (much smaller) renderer stays
// simpler than bending ThreadRow's per-thread contract to fit.
import { barHeightPx, formatClockTime, formatTokenCount, HOUR_MS, type HourlyBurnBucket } from "../src/core";

/** px, fixed width of each hour column — narrow enough that a month (720 columns) stays a reasonable scroll, wide enough to stay clickable/hoverable. */
const COL_WIDTH_PX = 5;
/** px, gap between hour columns. */
const COL_GAP_PX = 1;
/** px, chart height — the tallest bar fills exactly this. */
const CHART_HEIGHT_PX = 56;
/** px, floor for a non-zero bar's height so a very small hour is still visible as a sliver, not a 0px line. */
const MIN_BAR_HEIGHT_PX = 2;

function fmtHourRange(hourStartMs: number): string {
  return `${formatClockTime(hourStartMs)}–${formatClockTime(hourStartMs + HOUR_MS)}`;
}

export function HourlyBurnChart({ buckets }: { buckets: readonly HourlyBurnBucket[] }) {
  const maxTokens = buckets.reduce((max, b) => Math.max(max, b.tokens), 0);

  if (maxTokens === 0) {
    return <p className="text-xs text-subtle-foreground">No token usage in this period.</p>;
  }

  // Non-empty buckets and maxTokens > 0 guarantee at least one bucket's
  // tokens === maxTokens, so `peak` is always found — no fallback needed.
  const peak = buckets.find((b) => b.tokens === maxTokens)!;

  return (
    <div className="w-full overflow-x-auto">
      <div
        role="img"
        aria-label={`Burn by hour: peak ${formatTokenCount(maxTokens)} tokens at ${fmtHourRange(peak.hourStartMs)}`}
        className="flex items-end rounded-sm"
        style={{ height: CHART_HEIGHT_PX, gap: COL_GAP_PX }}
      >
        {buckets.map((bucket) => (
          <div
            key={bucket.hourStartMs}
            aria-hidden="true"
            className="relative shrink-0 self-stretch"
            style={{ width: COL_WIDTH_PX }}
            title={`${fmtHourRange(bucket.hourStartMs)}\n${formatTokenCount(bucket.tokens)} tokens`}
          >
            <div
              className="absolute bottom-0 w-full rounded-[1px] bg-primary/70"
              style={{ height: barHeightPx(bucket.tokens, maxTokens, CHART_HEIGHT_PX, MIN_BAR_HEIGHT_PX) }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
