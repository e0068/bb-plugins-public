// Cost cuts for the "Usage Analytics" summary block above the feed: how much
// each BB project (and each thread within it) spent inside a rolling time
// window, plus the donut geometry that draws the project split.
//
// Pure and total, like the rest of src/core: no I/O, no clock. "Now" and the
// window boundary arrive as numbers from the page — that's what keeps the
// laws below testable without freezing time (see
// memory/decisions/usage-pie-rolling-windows.md).
import { binTotal, type ThreadEntry } from "./threads-timeline";

// The D/W/M cuts and their rolling lengths, plus windowStartMs, now live in the
// shared engine (packages/analytics-viz core) — layer 1a lifted this verbatim
// out of here. Re-exported under the plugin's long-standing names so callers
// don't churn (BBPL-261). Binning stays local: hourly-burn.ts keeps its own
// grid-strict edge policy, which the generalised bucketByTime deliberately does
// not share (see memory/decisions/analytics-viz-binning-conserves-over-grid-align.md).
export {
  WINDOWS as COST_WINDOWS,
  WINDOW_MS as COST_WINDOW_MS,
  windowStartMs,
} from "../../packages/analytics-viz/core/time-window";
export type { Window as CostWindow } from "../../packages/analytics-viz/core/time-window";

/** How many of the window's threads the row list can show at once. */
export const ROW_LIMIT_OPTIONS = [5, 10, 15, 25, 50, 100] as const;
export type RowLimit = (typeof ROW_LIMIT_OPTIONS)[number];
export const DEFAULT_ROW_LIMIT: RowLimit = 15;

/**
 * Whether a window's total, computed from `threads`, might be missing older
 * sessions the fetched slice never reached.
 *
 * `sliceTruncated` alone (ThreadsTimeline's own `truncated` — see
 * threads-timeline.ts) isn't enough to decide this per window: a slice can
 * be truncated by its `limit` and still fully cover a short window like
 * "day", because everything cut off is even older than the window needs. A
 * window is only actually short-changed when the slice ran out before
 * reaching back as far as the window's own start — i.e. the oldest thread
 * still in the slice is no older than `fromMs`. `sliceTruncated` alone would
 * also false-positive on a small account whose few threads are all recent by
 * coincidence (nothing was cut off, there's just no older history to find) —
 * that's exactly what this combination rules out.
 */
export function windowMayBeIncomplete(threads: readonly ThreadEntry[], fromMs: number, sliceTruncated: boolean): boolean {
  if (!sliceTruncated || threads.length === 0) return false;
  const oldestEndMs = threads.reduce((min, t) => Math.min(min, Date.parse(t.end)), Infinity);
  return oldestEndMs >= fromMs;
}

/**
 * Label for sessions with no BB thread match (`bbProjectName === null`) —
 * the same bucket the feed's project picker calls "Threads", named once here
 * so the picker and the donut can't drift apart.
 */
export const THREADS_BUCKET_LABEL = "Threads";

/**
 * Which threads a list is cut down to. A sum type rather than a nullable
 * project key: `null` is itself a valid key (the unmatched bucket above), so
 * "no project selected" needs its own variant, not a second meaning for null.
 */
export type ProjectSelection = { kind: "all" } | { kind: "project"; key: string | null };

/** One sector of the donut: a BB project's spend inside the window. */
export interface ProjectCostSlice {
  /** BB project name, or null for the unmatched "Threads" bucket. */
  key: string | null;
  label: string;
  cost: number;
  /** `cost` as a fraction of the window's total — the sector's arc length. */
  share: number;
}

/** One row of the thread list to the right of the donut. */
export interface ThreadCostRow {
  session: string;
  threadId: string | null;
  label: string;
  projectKey: string | null;
  cost: number;
  /** `cost` relative to the most expensive row — the bar's width fraction, always 1 for the first row. */
  barFraction: number;
}

/**
 * Display name of a thread: BB's own title when the session matched one; else
 * the recovered BB project name (tier 2/3 of enrichBbProjects can find a
 * project even without a thread match — see threads-timeline-service.ts)
 * paired with a short session id so same-project rows stay distinguishable;
 * else, with no project either (the true "Threads" bucket), the short
 * session id alone.
 */
export function threadDisplayLabel(thread: ThreadEntry): string {
  if (thread.bbThreadTitle) return thread.bbThreadTitle;
  const shortSession = thread.session.slice(0, 8);
  return thread.bbProjectName ? `${thread.bbProjectName} · ${shortSession}` : shortSession;
}

function projectLabel(key: string | null): string {
  return key ?? THREADS_BUCKET_LABEL;
}

/**
 * The thread's spend that falls inside `[fromMs, ∞)`, prorated by the share
 * of its tokens whose bins start inside the window — see
 * memory/decisions/usage-pie-cost-prorated-by-bins.md for why attributing a
 * session to a single date was rejected.
 *
 * Total on every input: a thread whose bins carry no tokens at all (a slice
 * too coarse to have caught anything, or an empty session) falls back to its
 * last activity — all of the cost, or none. A bin with an unparseable
 * timestamp is counted in the denominator but never inside a window: it has
 * no known time, and guessing one would silently move money between periods.
 */
export function threadCostInWindow(thread: ThreadEntry, fromMs: number): number {
  if (!Number.isFinite(thread.totalCost) || thread.totalCost <= 0) return 0;

  let tokensTotal = 0;
  let tokensInWindow = 0;
  for (const bin of thread.bins) {
    const tokens = binTotal(bin);
    tokensTotal += tokens;
    // NaN (unparseable `t`) fails this comparison, so such a bin stays out.
    if (Date.parse(bin.t) >= fromMs) tokensInWindow += tokens;
  }

  if (tokensTotal <= 0) {
    return Date.parse(thread.end) >= fromMs ? thread.totalCost : 0;
  }
  return thread.totalCost * (tokensInWindow / tokensTotal);
}

/**
 * Per-project spend inside the window, most expensive first (ties broken by
 * label so the order — and therefore the sector colours — stay stable across
 * renders). Projects that spent nothing in the window are absent rather than
 * present with a zero: a sector of zero length is not a thing to look at.
 */
export function projectCostSlices(threads: readonly ThreadEntry[], fromMs: number): ProjectCostSlice[] {
  const costs = new Map<string | null, number>();
  for (const thread of threads) {
    const cost = threadCostInWindow(thread, fromMs);
    if (cost <= 0) continue;
    costs.set(thread.bbProjectName, (costs.get(thread.bbProjectName) ?? 0) + cost);
  }

  // `costs` only ever holds entries with a positive cost (see the `continue`
  // above), so a non-empty map always has a positive total — no `total > 0`
  // guard needed, and an empty map never reaches the division at all.
  const total = Array.from(costs.values()).reduce((sum, cost) => sum + cost, 0);
  return Array.from(costs.entries())
    .map(([key, cost]) => ({ key, label: projectLabel(key), cost, share: cost / total }))
    .sort((a, b) => b.cost - a.cost || a.label.localeCompare(b.label));
}

/**
 * Every BB project referenced anywhere in `threads`, alphabetically, with the
 * unmatched "Threads" bucket (`null`) last when present — the stable order a
 * caller can index project colours by. Deliberately independent of any
 * window: {@link
 * projectCostSlices} sorts by cost, which changes with the D/W/M window, and
 * a project whose colour depends on its rank would repaint itself every time
 * the window changes which project spent more.
 */
export function allProjectKeys(threads: readonly ThreadEntry[]): Array<string | null> {
  const names = new Set<string>();
  let hasUnmatched = false;
  for (const thread of threads) {
    if (thread.bbProjectName === null) hasUnmatched = true;
    else names.add(thread.bbProjectName);
  }
  const sorted = Array.from(names).sort();
  return hasUnmatched ? [...sorted, null] : sorted;
}

/**
 * `selection` narrowed to what `slices` can actually satisfy: a
 * `{kind:"project"}` selection whose key has no slice in the current window
 * (the window shrank past it, or the RPC's own cap dropped it) reads back as
 * `{kind:"all"}` instead of silently filtering the thread list down to
 * nothing with no visible cause. `{kind:"all"}` always passes through
 * unchanged — there's nothing to narrow it against.
 */
export function resolveProjectSelection(
  selection: ProjectSelection,
  slices: readonly ProjectCostSlice[],
): ProjectSelection {
  if (selection.kind === "all") return selection;
  return slices.some((slice) => slice.key === selection.key) ? selection : { kind: "all" };
}

/**
 * Threads of the window, most expensive first, each with the bar width that
 * shows its cost against the most expensive one of the same list. Relative to
 * the maximum, not to the total: the list is read as "this thread against
 * that one", and against a total a normal thread would collapse into an
 * unreadable sliver next to one runaway session.
 */
export function threadCostRows(
  threads: readonly ThreadEntry[],
  fromMs: number,
  selection: ProjectSelection,
): ThreadCostRow[] {
  const rows = threads
    .filter((thread) => selection.kind === "all" || thread.bbProjectName === selection.key)
    .map((thread) => ({
      session: thread.session,
      threadId: thread.threadId,
      label: threadDisplayLabel(thread),
      projectKey: thread.bbProjectName,
      cost: threadCostInWindow(thread, fromMs),
    }))
    .filter((row) => row.cost > 0)
    .sort((a, b) => b.cost - a.cost || a.session.localeCompare(b.session));

  // Empty `rows` never reaches the division below (`.map` over `[]` is a
  // no-op); a non-empty `rows` has `rows[0].cost > 0` (filtered above), so
  // `maxCost` is positive whenever the division actually runs.
  const maxCost = rows[0]?.cost ?? 0;
  return rows.map((row) => ({ ...row, barFraction: row.cost / maxCost }));
}

/** The first `limit` rows — `threadCostRows` is already sorted, so this keeps the costliest ones. */
export function limitRows<T>(rows: readonly T[], limit: RowLimit): readonly T[] {
  return rows.slice(0, limit);
}

/** One donut sector as SVG stroke parameters — see {@link donutArcs}. */
export interface DonutArc {
  /** Length of the drawn arc along the circle. */
  dash: number;
  /** Length of the gap that follows it — the rest of the circle. */
  gap: number;
  /** `stroke-dashoffset`: negative, shifting the arc to where the previous ones ended. */
  offset: number;
}

/**
 * Turns shares into stroke-dasharray/dashoffset pairs for concentric circles
 * — one circle per sector, laid head to tail from the top.
 *
 * Deliberately not arc paths: a single project holding 100% of the spend is
 * the normal case here, and a 360° `A` command degenerates (start point ==
 * end point draws nothing). Dashes have no such special case.
 *
 * Total on every input, including a set of shares the caller didn't
 * normalize: a non-finite or negative share reads as 0, and every arc is
 * clamped against whatever fraction of the circle the PRECEDING arcs left
 * — not just against its own share — so shares summing past 1 (a division
 * the caller didn't guard, or simply an over-generous input) never overrun
 * the circle or overlap the next arc; the excess degenerates to a zero-length
 * arc instead.
 */
export function donutArcs(shares: readonly number[], circumference: number): DonutArc[] {
  const { arcs } = shares.reduce(
    ({ arcs, consumed }, share) => {
      const safe = Number.isFinite(share) ? Math.max(share, 0) : 0;
      const remaining = Math.max(circumference - consumed, 0);
      const dash = Math.min(safe * circumference, remaining);
      // `-consumed` on the first arc would be -0, which reads back as "-0"
      // in the DOM attribute; the offset is a plain 0 there instead.
      const arc: DonutArc = { dash, gap: circumference - dash, offset: consumed === 0 ? 0 : -consumed };
      return { arcs: [...arcs, arc], consumed: consumed + dash };
    },
    { arcs: [] as DonutArc[], consumed: 0 },
  );
  return arcs;
}
