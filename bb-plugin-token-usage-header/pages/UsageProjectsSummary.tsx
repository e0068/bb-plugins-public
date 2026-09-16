// Cost summary block above the "Usage Analytics" feed: a donut of spend by
// BB project over a rolling D/W/M window, and a list of the window's threads
// with cost bars. Pure aggregation (windows, proration, shares, sort, donut
// geometry, project order, selection narrowing) lives in
// src/core/project-costs.ts; this component is the imperative shell — its
// own fetch, its own period/selection state.
//
// Runs its own threadsTimeline call at a fixed limit instead of reading the
// feed's `threads` state below: the feed's slice grows as the user scrolls,
// which would make this block's numbers change on their own mid-scroll — see
// memory/decisions/usage-pie-own-100-slice.md.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  COST_WINDOWS,
  DEFAULT_ROW_LIMIT,
  ROW_LIMIT_OPTIONS,
  allProjectKeys,
  donutArcs,
  formatCost,
  hourlyBurnBuckets,
  limitRows,
  projectCostSlices,
  resolveProjectSelection,
  threadCostRows,
  windowMayBeIncomplete,
  windowStartMs,
  type CostWindow,
  type ProjectSelection,
  type RowLimit,
  type ThreadEntry,
} from "../src/core";
import { DEFAULT_PALETTE } from "./thread-chart";
import { HourlyBurnChart } from "./hourly-burn-chart";

// The fast, default slice — fetched on mount so "day" (the initial period)
// renders quickly. On a busy account this alone is measured at ~1.4s.
const SUMMARY_LIMIT = 100;
// Fetched once, lazily, only when the user switches to "week" or "month" —
// see the widening effect below. "day" only ever needs ~24h of history,
// which SUMMARY_LIMIT already covers on every account tried so far; a
// tenfold slice is measured at ~12s (python-script time alone, before this
// RPC's own BB-project/git enrichment on top), too slow to pay on every
// mount for a period most opens don't even select.
const WIDE_LIMIT = 1000;
// Coarser than the feed's own gear.unit (typically 60s): this block only
// needs enough bin resolution to place a session's activity against a
// day/week/month boundary, not to draw a per-column chart.
const SUMMARY_UNIT_SECONDS = 3600;

const WINDOW_LABELS: Record<CostWindow, string> = { day: "D", week: "W", month: "M" };
const WINDOW_TITLES: Record<CostWindow, string> = { day: "Last 24 hours", week: "Last 7 days", month: "Last 30 days" };

const RADIUS = 52;
const STROKE_WIDTH = 16;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const SVG_SIZE = (RADIUS + STROKE_WIDTH) * 2;

const THREADS_BUCKET_KEY = "—threads—";

export function UsageProjectsSummary({ onOpenSession }: { onOpenSession: (session: string) => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [threads, setThreads] = useState<ThreadEntry[]>([]);
  const [sliceTruncated, setSliceTruncated] = useState(false);
  // Which limit produced the currently-loaded `threads` — starts at the fast
  // slice's own, replaced with WIDE_LIMIT once the widening fetch below
  // resolves. Drives the capped-slice caption's own wording.
  const [activeLimit, setActiveLimit] = useState(SUMMARY_LIMIT);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [period, setPeriod] = useState<CostWindow>("day");
  // How many of the window's threads the row list on the right shows —
  // independent of `period`, so switching D/W/M keeps the user's choice.
  const [rowLimit, setRowLimit] = useState<RowLimit>(DEFAULT_ROW_LIMIT);
  // Idle until the user first asks for "week"/"month"; "loading" while the
  // wide fetch below is in flight; "loaded" once it has resolved (success or
  // failure) — gates the widening effect so it fires at most once per mount.
  const [wideSlice, setWideSlice] = useState<"idle" | "loading" | "loaded">("idle");
  // The user's raw intent — kept even when the current window can't show it
  // (see `activeSelection` below), so switching back to a wider window
  // re-applies the same choice instead of forgetting it.
  const [selection, setSelection] = useState<ProjectSelection>({ kind: "all" });

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    rpc.call("threadsTimeline", { limit: SUMMARY_LIMIT, unit: SUMMARY_UNIT_SECONDS }).then(
      (result) => {
        if (!mountedRef.current) return;
        if (result.status === "ready") {
          setThreads(result.threads);
          setSliceTruncated(result.truncated);
          setNowMs(Date.now());
          setPhase("ready");
        } else {
          setPhase("error");
        }
      },
      () => {
        if (mountedRef.current) setPhase("error");
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc]);

  // Widening: "week"/"month" need more history than the fast slice reliably
  // covers, but paying WIDE_LIMIT's ~12s on every mount (including the many
  // opens that only ever look at "day") isn't worth it — fetch the bigger
  // slice lazily, the first time the user actually asks for a longer window,
  // and reuse it from then on (switching back to "day" still reads off
  // whatever's loaded; a wider slice is always a superset, never wrong for a
  // narrower window).
  useEffect(() => {
    if (period === "day" || wideSlice !== "idle") return;
    setWideSlice("loading");
    rpc.call("threadsTimeline", { limit: WIDE_LIMIT, unit: SUMMARY_UNIT_SECONDS }).then(
      (result) => {
        if (!mountedRef.current) return;
        if (result.status === "ready") {
          setThreads(result.threads);
          setSliceTruncated(result.truncated);
          setActiveLimit(WIDE_LIMIT);
        }
        setWideSlice("loaded");
      },
      () => {
        // Best-effort: leave the fast slice's numbers in place rather than
        // erroring the whole block out over an optional upgrade.
        if (mountedRef.current) setWideSlice("loaded");
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, rpc]);

  const fromMs = useMemo(() => windowStartMs(period, nowMs), [period, nowMs]);
  const slices = useMemo(() => projectCostSlices(threads, fromMs), [threads, fromMs]);
  // Narrowed against THIS window's slices: a project selected in "month" that
  // has no spend in "day" reads back as "all" here, so switching periods
  // never leaves the row list filtered down to nothing with no visible
  // control to clear it.
  const activeSelection = useMemo(() => resolveProjectSelection(selection, slices), [selection, slices]);
  const rows = useMemo(() => threadCostRows(threads, fromMs, activeSelection), [threads, fromMs, activeSelection]);
  const visibleRows = useMemo(() => limitRows(rows, rowLimit), [rows, rowLimit]);
  const arcs = useMemo(() => donutArcs(slices.map((s) => s.share), CIRCUMFERENCE), [slices]);
  const total = useMemo(() => slices.reduce((sum, s) => sum + s.cost, 0), [slices]);
  // Colour order from the full 100-session slice, not from `slices` (which
  // sorts by cost and therefore reorders itself across D/W/M) — a project's
  // colour must stay the same regardless of which window currently has it
  // spending the most.
  const projectOrder = useMemo(() => allProjectKeys(threads), [threads]);
  // Whole-window burn, independent of the project selection below — the
  // point of an hourly chart is the account's own burn rate, not one
  // project's slice of it.
  const hourlyBuckets = useMemo(() => hourlyBurnBuckets(threads, fromMs, nowMs), [threads, fromMs, nowMs]);
  // Whether THIS window's total might be missing older sessions the fetched
  // slice never reached — see windowMayBeIncomplete's doc comment. Per
  // window, not a blanket "the slice was capped": a short window like "day"
  // is usually still complete even when the slice as a whole was cut off.
  const incomplete = windowMayBeIncomplete(threads, fromMs, sliceTruncated);

  function colorFor(key: string | null): string {
    // Every key passed here comes from `slices` or `rows`, both derived from
    // `threads` — always present in `projectOrder`, so no "not found" guard.
    return DEFAULT_PALETTE[projectOrder.indexOf(key) % DEFAULT_PALETTE.length];
  }

  function isActive(key: string | null): boolean {
    return activeSelection.kind === "all" || activeSelection.key === key;
  }

  function toggleProject(key: string | null) {
    setSelection((prev) => (prev.kind === "project" && prev.key === key ? { kind: "all" } : { kind: "project", key }));
  }

  if (phase === "error") {
    // The feed below issues the same RPC and already surfaces its failure —
    // no need to show the same error message twice.
    return null;
  }

  return (
    <section className="flex flex-wrap items-start gap-8 border-b border-border pb-6" aria-label="Cost by project">
      <div className="flex shrink-0 flex-col items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="flex gap-1" role="group" aria-label="Period">
            {COST_WINDOWS.map((w) => (
              <Button
                key={w}
                type="button"
                size="sm"
                variant={period === w ? "default" : "outline"}
                aria-label={WINDOW_TITLES[w]}
                aria-pressed={period === w}
                onClick={() => setPeriod(w)}
              >
                {WINDOW_LABELS[w]}
              </Button>
            ))}
          </div>

          <Select value={String(rowLimit)} onValueChange={(value) => setRowLimit(Number(value) as RowLimit)}>
            <SelectTrigger aria-label="Rows shown" className="h-8 w-[4.5rem] px-2 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROW_LIMIT_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="relative" style={{ width: SVG_SIZE, height: SVG_SIZE }}>
          <svg width={SVG_SIZE} height={SVG_SIZE} viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}>
            <g transform={`translate(${SVG_SIZE / 2}, ${SVG_SIZE / 2}) rotate(-90)`}>
              <circle r={RADIUS} fill="none" stroke="var(--border)" strokeWidth={STROKE_WIDTH} />
              {slices.map((slice, i) => (
                // Decorative/mouse-only: the legend below is the one
                // keyboard- and screen-reader-reachable control for the same
                // action, so a sector isn't its own unreachable "button".
                <circle
                  key={slice.key ?? THREADS_BUCKET_KEY}
                  r={RADIUS}
                  fill="none"
                  stroke={colorFor(slice.key)}
                  strokeWidth={STROKE_WIDTH}
                  strokeDasharray={`${arcs[i].dash} ${arcs[i].gap}`}
                  strokeDashoffset={arcs[i].offset}
                  opacity={isActive(slice.key) ? 1 : 0.35}
                  className="cursor-pointer transition-opacity"
                  aria-hidden="true"
                  data-project={slice.key ?? THREADS_BUCKET_KEY}
                  onClick={() => toggleProject(slice.key)}
                />
              ))}
            </g>
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-base font-semibold tabular-nums text-foreground" aria-label={`Total cost: ${formatCost(total)}`}>
              {formatCost(total)}
            </span>
            <span className="text-[10px] uppercase text-muted-foreground">{WINDOW_LABELS[period]}</span>
          </div>
        </div>

        <div className="flex w-44 flex-col gap-1">
          {slices.map((slice) => (
            <button
              key={slice.key ?? THREADS_BUCKET_KEY}
              type="button"
              className="flex items-center gap-2 text-left text-xs"
              aria-pressed={activeSelection.kind === "project" && activeSelection.key === slice.key}
              onClick={() => toggleProject(slice.key)}
            >
              <span className="inline-block size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: colorFor(slice.key) }} />
              <span className={`min-w-0 flex-1 truncate ${isActive(slice.key) ? "text-foreground" : "text-subtle-foreground"}`}>
                {slice.label}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{formatCost(slice.cost)}</span>
            </button>
          ))}
          {slices.length === 0 && phase === "ready" && <p className="text-xs text-subtle-foreground">No spend in this period.</p>}
        </div>

        {wideSlice === "loading" ? (
          <p className="w-44 text-center text-[10px] text-subtle-foreground">Loading more sessions…</p>
        ) : (
          incomplete && (
            <p className="w-44 text-center text-[10px] text-subtle-foreground">
              Limited to the last {activeLimit} sessions — this total may be missing older ones.
            </p>
          )
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        {phase === "loading" && <p className="text-xs text-subtle-foreground">Loading…</p>}
        {visibleRows.map((row) => (
          <button
            key={row.session}
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-1 py-0.5 text-left hover:bg-accent"
            onClick={() => onOpenSession(row.session)}
          >
            <span className="w-40 shrink-0 truncate text-xs text-foreground">{row.label}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full"
                style={{ width: `${row.barFraction * 100}%`, backgroundColor: colorFor(row.projectKey) }}
              />
            </span>
            <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{formatCost(row.cost)}</span>
          </button>
        ))}
        {rows.length === 0 && phase === "ready" && <p className="text-xs text-subtle-foreground">No threads in this period.</p>}
      </div>

      {phase === "ready" && (
        <section className="w-full space-y-1" aria-label="Burn by hour">
          <p className="text-[10px] uppercase text-muted-foreground">Burn by hour</p>
          <HourlyBurnChart buckets={hourlyBuckets} />
        </section>
      )}
    </section>
  );
}
