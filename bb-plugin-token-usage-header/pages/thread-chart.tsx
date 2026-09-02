// The one token-usage chart frame, shared by both pages: the feed
// (ThreadsTimelinePage renders one ThreadRow per session) and the session page
// (AgentTimelinePage renders a single SessionChartCard for the open session).
// Extracted here rather than exported from either page so neither imports the
// other — ThreadsTimelinePage already depends on AgentTimelinePage
// (buildAgentDetailSubPath), and a back-edge would make the two page modules
// circular. This module depends only on core + the SDK.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/ui/icon";
import { usePortalScopeProps } from "@/lib/portal-scope";
import {
  binTotal,
  formatCost,
  formatPercent,
  formatTokenCount,
  gitEventLabel,
  gitEventLinkUrl,
  type AgentBin,
  type ChartSettings,
  type GitEvent,
  type ThreadEntry,
  type TimelineBin,
} from "../src/core";

/** Fixed, subtle alpha for the chart frame's lift tint — only the hue is user-configurable (native `<input type="color">` has no alpha channel). */
export const FRAME_LIFT_ALPHA = 0.05;
/** Stronger lift alpha applied while the whole card is hovered (only when it's clickable, i.e. onOpenCard is set) — the "card lights up on hover" feedback. */
export const FRAME_LIFT_ALPHA_HOVER = 0.14;
/** Floor for the graph's own width when fillWidth is off (colWidthPx * 0 bins would otherwise collapse it). */
const MIN_GRAPH_WIDTH_PX = 4;
/** Horizontal chrome of the card the graph sits in — p-3 (12px) on both sides plus a 1px border on each — so a hug card can be sized to exactly hold its graph. */
const CARD_FRAME_PX = 12 * 2 + 1 * 2;
/** Floor for a hug card's width — a very short session's graph is only a few px wide; without this the card would collapse to an unreadable sliver. */
const MIN_HUG_CARD_WIDTH_PX = 96;
/** Fade-out duration of the column tooltip: on leave it eases to transparent over this long, then unmounts (no fully-visible hold). */
const TOOLTIP_FADE_MS = 200;
/** Minimum gap (px) kept between the column tooltip and the viewport edge when clamping its position — see the tooltip's useLayoutEffect below. */
const TOOLTIP_VIEWPORT_MARGIN_PX = 8;
/** Default chart height (px) for the single-session card, mirroring the feed's own BASE_CHART_HEIGHT — scaled by settings.heightScale, same as the feed. */
const SESSION_CARD_CHART_HEIGHT = 72;

/** Cycled by first-seen order (main first, then by total spend) — a free choice: agent colour is chart data, not UI chrome. */
export const DEFAULT_PALETTE = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4", "#eab308", "#14b8a6", "#ec4899", "#84cc16"];

/** Opacity applied to a segment belonging to an agent OTHER than activeAgentKey — see ThreadRow's activeAgentKey prop. */
export const FADED_SEGMENT_OPACITY = "opacity-40";

/**
 * Whether a bin's agent segment "contains" agentKey — either the segment IS
 * that agent, or (for a workflow-merged segment, see tools/threads_timeline.py's
 * `members`) that agent's own contribution was folded into it. A plain
 * (non-workflow) segment has no `members`, so it only ever matches by key.
 */
export function segmentContainsAgent(agent: AgentBin, agentKey: string): boolean {
  return agent.key === agentKey || (agent.members?.includes(agentKey) ?? false);
}

/** Segment key prefix for a workflow-merged bin (see tools/threads_timeline.py's `--group-workflows`); its label is the workflow's human name, not a real agentId. */
export const WORKFLOW_KEY_PREFIX = "workflow:";

/**
 * A workflow-merged segment has no single agentId of its own — clicking it
 * picks one of its real `members` to open a detail page for. Prefers
 * `activeAgentKey` when it's a member (stay on the agent already open, just
 * jump its highlight window to this bin); otherwise falls back to the first
 * member (arbitrary but stable — the same segment always opens the same
 * agent). `members` is the sorted list of real agentIds folded into this
 * workflow run (empty/undefined only if the backend schema predates
 * SCHEMA_VERSION 4 — memory/decisions/workflow-segment-membership-backend.md);
 * null means the segment has nowhere to send the click, which keeps it a
 * no-op instead of guessing.
 */
export function resolveWorkflowClickTarget(agent: AgentBin, activeAgentKey: string | null | undefined): string | null {
  if (activeAgentKey && agent.members?.includes(activeAgentKey)) return activeAgentKey;
  return agent.members?.[0] ?? null;
}

export function hexToRgba(hex: string, alpha: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.substring(0, 2), 16) || 0;
  const g = parseInt(h.substring(2, 4), 16) || 0;
  const b = parseInt(h.substring(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s} s`;
  return `${s} s`;
}

function fmtClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

/**
 * One rendered column of a thread's chart. `bin: null` is an empty/no-activity
 * column — `gapUnits` counts how many raw (unit-sized) empty bins it stands
 * for: always 1 when collapseEmpty is off (one column per raw bin, same as
 * before this feature) or for a lone empty bin even when collapseEmpty is on;
 * >1 only when collapseEmpty merged a run of consecutive empty raw bins into
 * one gap column. A non-empty bin is always its own column (gapUnits: 1).
 */
export interface DisplayBin {
  /** bin.t of the first raw bin folded into this column — start of its time window. */
  t: string;
  gapUnits: number;
  bin: TimelineBin | null;
}

/**
 * Collapses a thread's raw per-unit bins into display columns. With
 * collapseEmpty off this is a 1:1 passthrough (every bin, empty or not, is
 * its own column) — the pre-feature behaviour. With it on, runs of
 * consecutive empty bins (no agents, or binTotal 0) merge into a single gap
 * column carrying their combined `gapUnits`; non-empty bins are never merged
 * and always keep their own column.
 */
export function computeDisplayBins(bins: readonly TimelineBin[], collapseEmpty: boolean): DisplayBin[] {
  const displayBins: DisplayBin[] = [];
  for (const bin of bins) {
    const isEmpty = bin.agents.length === 0 || binTotal(bin) === 0;
    if (!isEmpty) {
      displayBins.push({ t: bin.t, gapUnits: 1, bin });
      continue;
    }
    const last = displayBins[displayBins.length - 1];
    if (collapseEmpty && last && last.bin === null) {
      last.gapUnits += 1;
      continue;
    }
    displayBins.push({ t: bin.t, gapUnits: 1, bin: null });
  }
  return displayBins;
}

/** One icon per git event kind, for the marker lane and its tooltip section — see components/ui/icon.tsx's ICON_MAP. */
export const GIT_EVENT_ICON: Record<GitEvent["type"], IconName> = {
  commit: "GitCommit",
  push: "Upload",
  pr: "GitPullRequest",
  merge: "GitMerge",
};

/**
 * Buckets a thread's git events into the SAME display columns as its bars
 * (see computeDisplayBins) — an event lands in whichever column's time
 * window [t, t + gapUnits*unit) contains its own ts. Index-aligned with
 * displayBins: result[i] is displayBins[i]'s events, [] when none fall in
 * that window. An event with an unparseable ts is dropped, not thrown — the
 * marker lane is a bonus overlay, not something a single bad timestamp
 * should crash.
 */
export function bucketGitEventsByBin(displayBins: readonly DisplayBin[], events: readonly GitEvent[], unit: number): GitEvent[][] {
  return displayBins.map((displayBin) => {
    const startMs = Date.parse(displayBin.t);
    if (Number.isNaN(startMs)) return [];
    const endMs = startMs + displayBin.gapUnits * unit * 1000;
    return events.filter((event) => {
      const eventMs = Date.parse(event.ts);
      return !Number.isNaN(eventMs) && eventMs >= startMs && eventMs < endMs;
    });
  });
}

export function ThreadRow({
  thread,
  unit,
  chartHeight,
  maxBinTotal,
  perCardHeight,
  maxBinCount,
  agentKeys,
  colorFor,
  labelFor,
  onSegmentClick,
  onOpenThread,
  onOpenCard,
  fillWidth,
  hugWidth,
  collapseEmpty,
  colWidthPx,
  colGap,
  segGap,
  colRadius,
  segRadius,
  frameLiftColor,
  activeAgentKey,
}: {
  thread: ThreadEntry;
  unit: number;
  chartHeight: number;
  maxBinTotal: number;
  /** true = normalize column heights to THIS card's own tallest column (its tallest fills the card height); false = use the shared maxBinTotal across all cards. */
  perCardHeight: boolean;
  /** DISPLAYED column count of the longest visible thread (after collapseEmpty folding — see computeDisplayBins) — drives the uniform column width when fillWidth is on. */
  maxBinCount: number;
  agentKeys: readonly string[];
  colorFor: (agentKey: string) => string;
  /** Human-readable display text for an agentId (agentLabels[key] ?? key) — used only in the tooltip text, never as a key. */
  labelFor: (agentKey: string) => string;
  onSegmentClick: (agentKey: string, session: string, fromIso: string, toIso: string) => void;
  /** Opens the BB thread when the title is clicked — set only when the thread has a match (threadId); absent for the "Threads" bucket. */
  onOpenThread?: () => void;
  /**
   * Opens the session's internal page when the card is clicked anywhere,
   * including empty area. Set only in the feed (ThreadsTimelinePage); absent
   * on the session page's own card (SessionChartCard) — there's no
   * card-level interaction there. When set, the card highlights on hover and
   * becomes clickable; the title and segments stop propagation, keeping
   * their own behavior.
   */
  onOpenCard?: () => void;
  /** true = bin columns stretch to share the graph's width equally (flex-1); false = each bin column is a fixed colWidthPx wide. */
  fillWidth: boolean;
  /** true = card shrinks to the graph's width (w-fit) instead of stretching to the container (w-full); meaningful only when fillWidth is off. */
  hugWidth: boolean;
  /** true = consecutive empty bins render as one collapsed gap column — see computeDisplayBins. */
  collapseEmpty: boolean;
  /** px, fixed width of EACH bin column — used only when fillWidth is off. */
  colWidthPx: number;
  /** px, gap between bin columns. */
  colGap: number;
  /** px, gap between an agent's stacked segments inside one bin. */
  segGap: number;
  /** px, corner radius of a bin's segment stack as a whole. */
  colRadius: number;
  /** px, corner radius of each individual agent segment. */
  segRadius: number;
  /** hex; tint of the chart frame's subtle background lift (fixed low alpha — see FRAME_LIFT_ALPHA). */
  frameLiftColor: string;
  /** Agent key currently selected elsewhere on the page (e.g. the session page's right panel) — every OTHER agent's segments fade to FADED_SEGMENT_OPACITY. Absent/null: no fading, all segments full opacity (the feed's own rows, which have no notion of a selected agent). */
  activeAgentKey?: string | null;
}) {
  const threadEndMs = Date.parse(thread.end);

  // Titles come from bb.sdk (bbThreadTitle, see threads-timeline-service.ts) —
  // not the raw `title` from threads_timeline.py, which always equals session.
  // No match with a BB thread (the "Threads" bucket) — a short session id
  // instead of blank; the full session stays in the tooltip, not duplicated
  // in the header.
  const headerTitle = thread.bbThreadTitle ?? thread.session.slice(0, 8);
  const headerTooltip = thread.bbThreadTitle ? `${thread.bbThreadTitle}\n${thread.session}` : thread.session;
  // Count of distinct agents in the thread — computed from its own bins
  // (main agent + subagents), not from the global agentKeys (that's
  // aggregated across the whole feed).
  const agentCount = new Set(thread.bins.flatMap((b) => b.agents.map((a) => a.key))).size;

  // Displayed columns, not raw bins — collapseEmpty folds runs of empty bins
  // into one gap column each (see computeDisplayBins); binCount/graphWidthPx
  // below size the graph off however many columns are actually rendered.
  const displayBins = useMemo(() => computeDisplayBins(thread.bins, collapseEmpty), [thread.bins, collapseEmpty]);
  const binCount = displayBins.length;
  // Git activity markers (commit/push/pr/merge), index-aligned with
  // displayBins — rendered as a lane below the bars and folded into the same
  // hover tooltip (see the "Git" section below).
  const eventsByBin = useMemo(() => bucketGitEventsByBin(displayBins, thread.events, unit), [displayBins, thread.events, unit]);
  // Same width/gap every column, independent of which bin it is — computed
  // once here instead of per-iteration, and shared by BOTH the bars row and
  // the marker lane below so their columns line up pixel-for-pixel.
  const colClassName = "relative h-full min-w-[2px] shrink-0";
  const colStyle: React.CSSProperties = fillWidth
    ? { width: `calc((100% - ${Math.max(maxBinCount - 1, 0) * colGap}px) / ${maxBinCount})`, flexShrink: 0 }
    : { width: colWidthPx, flexShrink: 0 };
  const graphWidthPx = fillWidth
    ? undefined
    : Math.max(binCount * colWidthPx + Math.max(binCount - 1, 0) * colGap, MIN_GRAPH_WIDTH_PX);
  // Hug is only meaningful with a fixed graph width (fillWidth off): the card
  // is sized to hold exactly that graph, so its header (title + metrics) must
  // stop dictating the width — it stacks and truncates instead. maxWidth 100%
  // keeps a very wide graph from overflowing the row (its own overflow-x-auto
  // scrolls inside the capped card).
  const hug = hugWidth && !fillWidth;
  const cardWidthPx = hug ? Math.max((graphWidthPx ?? 0) + CARD_FRAME_PX, MIN_HUG_CARD_WIDTH_PX) : undefined;

  // Column-height reference: this card's own tallest column (perCard) or the
  // shared max across all cards (the default). perCard makes each card's
  // tallest column fill its height, at the cost of cross-card comparability.
  const localMaxBinTotal = useMemo(() => thread.bins.reduce((m, bin) => Math.max(m, binTotal(bin)), 0), [thread.bins]);
  const effectiveMaxBinTotal = perCardHeight ? localMaxBinTotal : maxBinTotal;

  // Time range, total and per-agent breakdown of one bin — shared by the
  // column render (segment heights) and the hover tooltip (its legend), so
  // the two never diverge on how a bin's agents are ordered or summed.
  function describeBin(bin: TimelineBin) {
    const binStartMs = Date.parse(bin.t);
    const binEndMs = Number.isNaN(threadEndMs) ? binStartMs + unit * 1000 : Math.min(binStartMs + unit * 1000, threadEndMs);
    const total = binTotal(bin);
    const timeLabel = `${fmtClock(bin.t)}–${fmtClock(new Date(binEndMs).toISOString())}`;
    const ordered = agentKeys.filter((key) => bin.agents.some((a) => a.key === key)).map((key) => bin.agents.find((a) => a.key === key)!);
    return { binEndMs, total, timeLabel, ordered };
  }

  // Hover tooltip for a data column. Driven by pointer move (not the native
  // `title` attribute, which the browser delays ~1s before showing) so the
  // per-agent legend appears immediately, and portaled to document.body so
  // the graph's own overflow-hidden/overflow-x-auto never clips it.
  const [tip, setTip] = useState<{ binIndex: number; x: number; y: number } | null>(null);
  // Whole-card hover, only tracked (and only visible) when the card is
  // clickable — drives the lift-tint bump on the whole frame, including its
  // empty area.
  const [cardHovered, setCardHovered] = useState(false);
  // On leave the tooltip eases to transparent over TOOLTIP_FADE_MS, then
  // unmounts — a fade-out, not a fully-visible grace hold. Moving onto another
  // column cancels the fade and re-shows at full opacity, so crossing the
  // chart never blinks it off and on.
  const [tipClosing, setTipClosing] = useState(false);
  const portalScope = usePortalScopeProps();
  const tipBin = tip ? displayBins[tip.binIndex]?.bin ?? null : null;

  // Keeps the tooltip on-screen: it's anchored at the cursor (tip.x/y + 12px),
  // which overflows the viewport's right/bottom edge for a column near the
  // chart's own edge (the popover itself is a fairly narrow, fixed-position
  // panel). Measured after mount/update (getBoundingClientRect gives its real
  // width/height regardless of any prior shift already applied — only
  // position is translated, not size), then nudged back inside by however
  // much it would otherwise overflow. useLayoutEffect (not useEffect) so the
  // correction lands before the browser paints — no visible jump.
  const tipRef = useRef<HTMLDivElement>(null);
  const [tipShift, setTipShift] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    if (!tip || !tipRef.current) return;
    const rect = tipRef.current.getBoundingClientRect();
    const naturalLeft = tip.x + 12;
    const naturalTop = tip.y + 12;
    const maxLeft = Math.max(TOOLTIP_VIEWPORT_MARGIN_PX, window.innerWidth - rect.width - TOOLTIP_VIEWPORT_MARGIN_PX);
    const maxTop = Math.max(TOOLTIP_VIEWPORT_MARGIN_PX, window.innerHeight - rect.height - TOOLTIP_VIEWPORT_MARGIN_PX);
    const clampedLeft = Math.min(Math.max(naturalLeft, TOOLTIP_VIEWPORT_MARGIN_PX), maxLeft);
    const clampedTop = Math.min(Math.max(naturalTop, TOOLTIP_VIEWPORT_MARGIN_PX), maxTop);
    setTipShift({ x: clampedLeft - naturalLeft, y: clampedTop - naturalTop });
  }, [tip]);

  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showTip(binIndex: number, x: number, y: number) {
    if (fadeTimerRef.current !== null) {
      clearTimeout(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }
    setTipClosing(false);
    setTip({ binIndex, x, y });
  }
  function startTipFade() {
    if (fadeTimerRef.current !== null) clearTimeout(fadeTimerRef.current);
    setTipClosing(true);
    fadeTimerRef.current = setTimeout(() => {
      setTip(null);
      setTipClosing(false);
      fadeTimerRef.current = null;
    }, TOOLTIP_FADE_MS);
  }
  useEffect(
    () => () => {
      if (fadeTimerRef.current !== null) clearTimeout(fadeTimerRef.current);
    },
    [],
  );

  const cardActive = Boolean(onOpenCard) && cardHovered;
  // Card-level interaction exists only in the feed (onOpenCard set); on the
  // session page's own card it's absent, so the whole block is empty there.
  const cardInteractive: React.HTMLAttributes<HTMLDivElement> = onOpenCard
    ? {
        role: "button",
        tabIndex: 0,
        "aria-label": `Open session detail: ${headerTitle}`,
        onClick: onOpenCard,
        onMouseEnter: () => setCardHovered(true),
        onMouseLeave: () => setCardHovered(false),
        onKeyDown: (e) => {
          // Enter/Space activate a role="button" — match native button keys so
          // keyboard users reach the same internal page as a click.
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenCard();
          }
        },
      }
    : {};

  return (
    <div
      className={`space-y-2 rounded-md border border-border p-3 transition-colors ${hug ? "" : "w-full"} ${
        onOpenCard ? "cursor-pointer ring-inset hover:ring-1 hover:ring-border" : ""
      }`}
      style={{
        backgroundColor: hexToRgba(frameLiftColor, cardActive ? FRAME_LIFT_ALPHA_HOVER : FRAME_LIFT_ALPHA),
        ...(hug ? { width: cardWidthPx, maxWidth: "100%" } : null),
      }}
      {...cardInteractive}
    >
      {/* In hug mode the header stacks into a column: title and metrics each
          on their own line and truncated, so they never force the card wider
          than the graph. Without hug — the usual row: title on the left,
          metrics on the right. */}
      <div className={`flex ${hug ? "flex-col gap-0.5" : "items-baseline justify-between gap-3"} overflow-hidden text-xs text-muted-foreground`}>
        {/* A live (non-archived) thread gets its name in green; work in
            progress right now adds a blinking green dot to the left of the
            name. The wrapper keeps the dot and name on one line, and itself
            takes the same width the name alone used to occupy. */}
        <div className={`flex min-w-0 items-center gap-1.5 ${hug ? "w-full" : "flex-1"}`}>
          {thread.isWorking && (
            <span
              className="size-1.5 shrink-0 animate-pulse rounded-full bg-success"
              role="img"
              aria-label="In progress"
              title="In progress"
            />
          )}
          {onOpenThread ? (
            <button
              type="button"
              className={`min-w-0 flex-1 truncate text-left font-medium ${thread.isAlive ? "text-success" : "text-foreground"} hover:underline focus-visible:underline focus-visible:outline-none`}
              title={headerTooltip}
              onClick={(e) => {
                // The title navigates to the BB thread — stop propagation so
                // the card's own click (session's internal page) doesn't also fire.
                e.stopPropagation();
                onOpenThread();
              }}
            >
              {headerTitle}
            </button>
          ) : (
            <span className={`min-w-0 flex-1 truncate font-medium ${thread.isAlive ? "text-success" : "text-foreground"}`} title={headerTooltip}>
              {headerTitle}
            </span>
          )}
        </div>
        <span className={`tabular-nums ${hug ? "w-full truncate" : "ml-auto shrink-0"}`}>
          {/* No workflows ran — omit them entirely rather than writing "0 workflows". */}
          {thread.workflowCount > 0 && `${thread.workflowCount} workflows · `}
          {agentCount} agents · {fmtDuration(thread.durationSec)} · {formatTokenCount(thread.totalTokens)} · {formatCost(thread.totalCost)}
        </span>
      </div>

      <div className="w-full overflow-x-auto">
        <div
          className="flex items-end overflow-hidden rounded-sm"
          style={{ height: chartHeight, width: fillWidth ? "100%" : graphWidthPx, gap: colGap }}
        >
          {displayBins.map((displayBin, binIndex) => {
            const { bin, gapUnits } = displayBin;
            // Columns are fixed-width in BOTH modes so every thread's columns
            // are the SAME width. fillWidth on: width = 100%/maxBinCount (the
            // longest thread's DISPLAYED columns), so only the longest fills
            // the row and shorter threads are proportionally narrower.
            // fillWidth off: each column is a fixed colWidthPx the "Width"
            // control sets. colClassName/colStyle are hoisted above (shared
            // with the marker lane below).

            if (bin === null) {
              // Empty column — either a single raw empty bin (collapseEmpty
              // off, gapUnits always 1) or a run of consecutive empty bins
              // folded into one (collapseEmpty on, gapUnits = run length).
              // Same muted "no activity" marker either way; only the tooltip
              // differs, carrying the total collapsed duration.
              return (
                <div
                  key={binIndex}
                  className={colClassName}
                  style={colStyle}
                  title={`${fmtClock(displayBin.t)}\n${fmtDuration(gapUnits * unit)} break`}
                >
                  <div className="absolute bottom-0 h-[2px] w-full bg-muted/50" style={{ borderRadius: segRadius }} />
                </div>
              );
            }

            const { binEndMs, total, ordered } = describeBin(bin);
            const dispHeight = effectiveMaxBinTotal > 0 ? Math.max((total / effectiveMaxBinTotal) * chartHeight, 2) : 2;

            // While the tooltip is showing this column, highlight the column
            // itself so it's clear which one the tooltip refers to.
            const columnActive = tip?.binIndex === binIndex && !tipClosing;
            return (
              <div
                key={binIndex}
                className={`${colClassName} rounded-sm transition-colors ${columnActive ? "bg-state-hover" : ""}`}
                style={colStyle}
                onMouseMove={(e) => showTip(binIndex, e.clientX, e.clientY)}
                onMouseLeave={startTipFade}
              >
                <div
                  className="absolute bottom-0 flex w-full flex-col-reverse overflow-hidden"
                  style={{ height: dispHeight, borderRadius: colRadius, gap: segGap }}
                >
                  {ordered.map((a) => {
                    const segHeight = (a.total / total) * dispHeight;
                    const faded = activeAgentKey != null && !segmentContainsAgent(a, activeAgentKey);
                    return (
                      <button
                        key={a.key}
                        type="button"
                        className={`block w-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${faded ? FADED_SEGMENT_OPACITY : ""}`}
                        style={{ height: Math.max(segHeight, 1), backgroundColor: colorFor(a.key), borderRadius: segRadius }}
                        aria-label={`${labelFor(a.key)}: ${formatTokenCount(a.total)} tokens`}
                        onClick={(e) => {
                          // The segment navigates to agent detail with a time
                          // window — stop propagation so the card's own click
                          // doesn't also fire. A workflow segment isn't tied
                          // to a single agentId — resolveWorkflowClickTarget
                          // picks whose detail to open (null — the segment
                          // has nowhere to go, the click is a no-op).
                          e.stopPropagation();
                          const targetKey = a.key.startsWith(WORKFLOW_KEY_PREFIX)
                            ? resolveWorkflowClickTarget(a, activeAgentKey)
                            : a.key;
                          if (targetKey) onSegmentClick(targetKey, thread.session, bin.t, new Date(binEndMs).toISOString());
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Git activity lane — same column widths/gaps as the bars above
            (colClassName/colStyle, width/gap), inside the SAME scroll
            wrapper so it always stays aligned under them, scrolled or not.
            A column with no events renders an empty (but width-holding) div
            — the lane's own height only ever depends on the tallest icon
            row, never the bars. */}
        <div className="mt-1 flex items-center" style={{ width: fillWidth ? "100%" : graphWidthPx, gap: colGap }}>
          {displayBins.map((displayBin, binIndex) => {
            const binEvents = eventsByBin[binIndex];
            return (
              <div
                key={binIndex}
                className="flex shrink-0 items-center justify-center gap-0.5"
                style={colStyle}
                // Only intercepts hover when there's actually something to
                // show — an empty column here (no git events) leaves the bar
                // row's own hover (native title on a gap column, or the
                // custom tooltip on a data column) as the only trigger.
                onMouseMove={binEvents.length > 0 ? (e) => showTip(binIndex, e.clientX, e.clientY) : undefined}
                onMouseLeave={binEvents.length > 0 ? startTipFade : undefined}
              >
                {binEvents.slice(0, 3).map((event, i) => (
                  <Icon key={i} name={GIT_EVENT_ICON[event.type]} className="size-2.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {tip
        ? (() => {
            const tipDisplayBin = displayBins[tip.binIndex];
            if (!tipDisplayBin) return null;
            const binData = tipBin ? describeBin(tipBin) : null;
            const timeLabel = binData ? binData.timeLabel : fmtClock(tipDisplayBin.t);
            const tipEvents = eventsByBin[tip.binIndex] ?? [];
            return createPortal(
              <div
                ref={tipRef}
                {...portalScope}
                // Interactive (not pointer-events-none, unlike before this
                // feature): a git event's link needs to be reachable by the
                // cursor. onMouseEnter/onMouseLeave below keep it open while
                // the cursor is over it (instead of fading the instant it
                // leaves the narrow column), the same "hoverable tooltip"
                // pattern any clickable-content popover needs.
                className={`fixed z-50 w-max max-w-[min(90vw,32rem)] rounded-md border border-border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md transition-opacity duration-200 ease-in ${
                  tipClosing ? "opacity-0" : "opacity-100"
                }`}
                style={{ left: tip.x + 12 + tipShift.x, top: tip.y + 12 + tipShift.y }}
                onMouseEnter={() => showTip(tip.binIndex, tip.x, tip.y)}
                onMouseLeave={startTipFade}
              >
                <div className="font-medium tabular-nums">{timeLabel}</div>
                {binData && (
                  <ul className="mt-1.5 space-y-1">
                    {binData.ordered.map((a) => (
                      <li key={a.key} className="flex w-full items-center gap-3">
                        <span className="inline-block size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: colorFor(a.key) }} />
                        <span className="whitespace-nowrap">{labelFor(a.key)}</span>
                        <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                          {formatTokenCount(a.total)} · {formatPercent(a.total, binData.total)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {tipEvents.length > 0 && (
                  <ul className={`space-y-1 ${binData ? "mt-2 border-t border-border pt-2" : "mt-1.5"}`}>
                    {tipEvents.map((event, i) => {
                      const url = gitEventLinkUrl(event);
                      return (
                        <li key={i} className="flex w-full items-center gap-2">
                          <Icon name={GIT_EVENT_ICON[event.type]} className="size-2.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          {url ? (
                            <a href={url} target="_blank" rel="noreferrer" className="truncate text-primary underline underline-offset-2 hover:no-underline">
                              {gitEventLabel(event)}
                            </a>
                          ) : (
                            <span className="truncate text-popover-foreground">{gitEventLabel(event)}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>,
              document.body,
            );
          })()
        : null}
    </div>
  );
}

/**
 * Single-session convenience wrapper around ThreadRow: the session page renders
 * exactly the feed's chart frame, so there's one implementation, not two. Takes
 * the SAME `ChartSettings` the feed reads (bb.settings.define's geometry
 * fields, see src/core/gear-settings.ts, plus the kv-persisted agentColors
 * map) instead of its own hardcoded geometry, so a setting changed on the
 * plugin's Settings page is visible here too — in the header popover
 * (app.tsx) and the session-detail page (AgentTimelinePage.tsx) alike, not
 * just the feed. Fills the remaining per-page inputs (agent labels, max
 * totals) from this one session's own bins. Segments merged server-side by
 * workflow (`groupWorkflows`) get a "Workflow: <name>" label so the
 * collapsed group is legible.
 */
export function SessionChartCard({
  thread,
  agentLabels,
  settings,
  fillWidth,
  onSelectAgent,
  activeAgentKey,
}: {
  thread: ThreadEntry;
  agentLabels: Record<string, string>;
  /** Chart geometry/behaviour from the plugin's Settings page, plus the kv-persisted per-agent colour overrides. */
  settings: ChartSettings;
  /**
   * Which of GearSettings's three fillWidth fields applies here — the caller
   * picks fillWidthPopover (header popup) or fillWidthSession (thread
   * breakdown page) since this same card is rendered in both places with
   * independent settings; ChartSettings carries all three, so it can't pick
   * the right one on its own.
   */
  fillWidth: boolean;
  /**
   * A segment click navigates to agent detail with the bin's time window
   * (fromIso/toIso), so the page highlights and scrolls to that window's
   * events — the same highlight as a deep-link from the feed. For a
   * workflow (merged) segment, agentKey is already resolved by ThreadRow via
   * resolveWorkflowClickTarget to a real member, not "workflow:...".
   */
  onSelectAgent?: (agentKey: string, fromIso: string, toIso: string) => void;
  /** Agent currently selected on the session page (right panel) — every other agent's segments fade to FADED_SEGMENT_OPACITY. */
  activeAgentKey?: string | null;
}) {
  const agentKeys = useMemo(() => {
    const totals = new Map<string, number>();
    thread.bins.forEach((bin) => bin.agents.forEach((a) => totals.set(a.key, (totals.get(a.key) ?? 0) + a.total)));
    return Array.from(totals.keys()).sort((a, b) => {
      if (a === "main") return -1;
      if (b === "main") return 1;
      return (totals.get(b) ?? 0) - (totals.get(a) ?? 0);
    });
  }, [thread.bins]);
  const maxBinTotal = useMemo(() => thread.bins.reduce((m, bin) => Math.max(m, binTotal(bin)), 0), [thread.bins]);
  const maxBinCount = useMemo(
    () => computeDisplayBins(thread.bins, settings.collapseEmpty).length,
    [thread.bins, settings.collapseEmpty],
  );

  const colorFor = (key: string) =>
    settings.agentColors[key] ?? DEFAULT_PALETTE[Math.max(agentKeys.indexOf(key), 0) % DEFAULT_PALETTE.length];
  const labelFor = (key: string) => {
    const name = agentLabels[key] ?? key;
    return key.startsWith(WORKFLOW_KEY_PREFIX) ? `Workflow: ${name}` : name;
  };

  return (
    <ThreadRow
      thread={thread}
      unit={settings.unit}
      chartHeight={SESSION_CARD_CHART_HEIGHT * settings.heightScale}
      maxBinTotal={maxBinTotal}
      perCardHeight={false}
      maxBinCount={maxBinCount}
      agentKeys={agentKeys}
      colorFor={colorFor}
      labelFor={labelFor}
      onSegmentClick={(agentKey, _session, fromIso, toIso) => onSelectAgent?.(agentKey, fromIso, toIso)}
      fillWidth={fillWidth}
      hugWidth={settings.hugWidth}
      collapseEmpty={settings.collapseEmpty}
      colWidthPx={settings.colWidthPx}
      colGap={settings.colGap}
      segGap={settings.segGap}
      colRadius={settings.colRadius}
      segRadius={settings.segRadius}
      frameLiftColor={settings.frameLiftColor}
      activeAgentKey={activeAgentKey}
    />
  );
}
