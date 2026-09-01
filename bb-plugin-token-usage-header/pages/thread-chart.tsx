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
import { usePortalScopeProps } from "@/lib/portal-scope";
import { binTotal, formatCost, formatPercent, formatTokenCount, type AgentBin, type ThreadEntry, type TimelineBin } from "../src/core";

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
/** Default chart height (px) for the single-session card, mirroring the feed's own BASE_CHART_HEIGHT. */
const SESSION_CARD_CHART_HEIGHT = 72;
/** Bin width (seconds) for a single-session chart — shared by every caller of SessionChartCard so they all bucket the same way. */
export const SESSION_CHART_UNIT = 60;

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
  if (h > 0) return `${h} ч ${m} мин`;
  if (m > 0) return `${m} мин ${s} с`;
  return `${s} с`;
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
  /** Открыть тред BB по клику на название — задан, только когда у треда есть матч (threadId); для бакета «Threads» отсутствует. */
  onOpenThread?: () => void;
  /**
   * Открыть внутреннюю страницу сессии по клику на карточку целиком (включая
   * пустую область). Задан только в ленте (ThreadsTimelinePage); в карточке
   * самой страницы сессии (SessionChartCard) отсутствует — там интерактива
   * уровня карточки нет. Когда задан, карточка подсвечивается на наведении и
   * становится кликабельной; заголовок и сегменты гасят всплытие, сохраняя
   * своё поведение.
   */
  onOpenCard?: () => void;
  /** true = bin columns stretch to share the graph's width equally (flex-1); false = each bin column is a fixed colWidthPx wide. */
  fillWidth: boolean;
  /** true = карточка сжимается под ширину графика (w-fit) вместо растягивания на контейнер (w-full); осмысленно при выключенном fillWidth. */
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

  // Названия из bb.sdk (bbThreadTitle, см. threads-timeline-service.ts) — не
  // сырой `title` из threads_timeline.py, который всегда равен session.
  // Нет матча с тредом BB (бакет «Threads») — короткий id сессии вместо
  // пустоты; полный session остаётся в подсказке, а не дублируется в шапке.
  const headerTitle = thread.bbThreadTitle ?? thread.session.slice(0, 8);
  const headerTooltip = thread.bbThreadTitle ? `${thread.bbThreadTitle}\n${thread.session}` : thread.session;
  // Число различных агентов треда — считается из его же бинов (главный "main"
  // + субагенты), а не из глобального agentKeys (тот собран по всей ленте).
  const agentCount = new Set(thread.bins.flatMap((b) => b.agents.map((a) => a.key))).size;

  // Displayed columns, not raw bins — collapseEmpty folds runs of empty bins
  // into one gap column each (see computeDisplayBins); binCount/graphWidthPx
  // below size the graph off however many columns are actually rendered.
  const displayBins = useMemo(() => computeDisplayBins(thread.bins, collapseEmpty), [thread.bins, collapseEmpty]);
  const binCount = displayBins.length;
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
        "aria-label": `Открыть детализацию сессии: ${headerTitle}`,
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
      {/* В hug шапка идёт колонкой: заголовок и метрики каждый в своей строке и
          обрезаются, поэтому не распирают карточку шире графика. Без hug —
          прежний ряд: заголовок слева, метрики справа. */}
      <div className={`flex ${hug ? "flex-col gap-0.5" : "items-baseline justify-between gap-3"} overflow-hidden text-xs text-muted-foreground`}>
        {/* Живой (не заархивированный) тред — имя зелёным; идёт работа сейчас —
            мигающая зелёная точка слева от имени. Обёртка держит точку и имя в
            одной строке, а сама занимает ту же ширину, что раньше занимало имя. */}
        <div className={`flex min-w-0 items-center gap-1.5 ${hug ? "w-full" : "flex-1"}`}>
          {thread.isWorking && (
            <span
              className="size-1.5 shrink-0 animate-pulse rounded-full bg-success"
              role="img"
              aria-label="Идёт работа"
              title="Идёт работа"
            />
          )}
          {onOpenThread ? (
            <button
              type="button"
              className={`min-w-0 flex-1 truncate text-left font-medium ${thread.isAlive ? "text-success" : "text-foreground"} hover:underline focus-visible:underline focus-visible:outline-none`}
              title={headerTooltip}
              onClick={(e) => {
                // Название ведёт в тред BB — гасим всплытие, чтобы клик по карточке
                // (внутренняя страница сессии) не сработал заодно.
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
          {/* Не было workflow — не упоминаем их вовсе, а не пишем «0 workflows». */}
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
            // fillWidth off: each column is a fixed colWidthPx the "Ширина"
            // control sets.
            const colClassName = "relative h-full min-w-[2px] shrink-0";
            const colStyle: React.CSSProperties = fillWidth
              ? { width: `calc((100% - ${Math.max(maxBinCount - 1, 0) * colGap}px) / ${maxBinCount})`, flexShrink: 0 }
              : { width: colWidthPx, flexShrink: 0 };

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
                  title={`${fmtClock(displayBin.t)}\nперерыв ${fmtDuration(gapUnits * unit)}`}
                >
                  <div className="absolute bottom-0 h-[2px] w-full bg-muted/50" style={{ borderRadius: segRadius }} />
                </div>
              );
            }

            const { binEndMs, total, ordered } = describeBin(bin);
            const dispHeight = effectiveMaxBinTotal > 0 ? Math.max((total / effectiveMaxBinTotal) * chartHeight, 2) : 2;

            // Пока тултип показывает этот столбец — подсвечиваем сам столбец,
            // чтобы было видно, к чему относится подсказка.
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
                        aria-label={`${labelFor(a.key)}: ${formatTokenCount(a.total)} токенов`}
                        onClick={(e) => {
                          // Сегмент ведёт в детализацию агента с окном времени —
                          // гасим всплытие, чтобы не сработал клик по карточке.
                          e.stopPropagation();
                          onSegmentClick(a.key, thread.session, bin.t, new Date(binEndMs).toISOString());
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {tip && tipBin
        ? (() => {
            const { total, timeLabel, ordered } = describeBin(tipBin);
            return createPortal(
              <div
                ref={tipRef}
                {...portalScope}
                className={`pointer-events-none fixed z-50 w-max max-w-[min(90vw,32rem)] rounded-md border border-border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md transition-opacity duration-200 ease-in ${
                  tipClosing ? "opacity-0" : "opacity-100"
                }`}
                style={{ left: tip.x + 12 + tipShift.x, top: tip.y + 12 + tipShift.y }}
              >
                <div className="font-medium tabular-nums">{timeLabel}</div>
                <ul className="mt-1.5 space-y-1">
                  {ordered.map((a) => (
                    <li key={a.key} className="flex w-full items-center gap-3">
                      <span className="inline-block size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: colorFor(a.key) }} />
                      <span className="whitespace-nowrap">{labelFor(a.key)}</span>
                      <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                        {formatTokenCount(a.total)} · {formatPercent(a.total, total)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>,
              document.body,
            );
          })()
        : null}
    </div>
  );
}

/** Prefix a workflow-merged segment's label so the group reads as one Workflow, not a nameless agent (its key is `workflow:<runId>`, its label the workflow's human name). */
const WORKFLOW_KEY_PREFIX = "workflow:";

/**
 * Single-session convenience wrapper around ThreadRow: the session page renders
 * exactly the feed's chart frame, so there's one implementation, not two. Fills
 * the feed's per-page inputs (colours, labels, max totals, default geometry)
 * from this one session's own bins. Segments merged server-side by workflow
 * (`groupWorkflows`) get a "Workflow: <name>" label so the collapsed group is
 * legible.
 */
export function SessionChartCard({
  thread,
  unit,
  agentLabels,
  onSelectAgent,
  activeAgentKey,
}: {
  thread: ThreadEntry;
  unit: number;
  agentLabels: Record<string, string>;
  /** Клик по сегменту реального агента ведёт на его детализацию; workflow-сегмент (сводный) кликом не открывается. */
  onSelectAgent?: (agentKey: string) => void;
  /** Агент, выбранный сейчас на странице сессии (правая панель) — сегменты остальных агентов гасятся до FADED_SEGMENT_OPACITY. */
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
  // Пробои схлопываются всегда — оба вызывающих места (страница сессии и
  // попап шапки) хотят одно и то же: пауза без активности не должна растягивать
  // ось на всю длину простоя. Не проп: конфигурируемости не требуется ни
  // одному из двух мест, где эта карточка используется.
  const maxBinCount = useMemo(() => computeDisplayBins(thread.bins, true).length, [thread.bins]);

  const colorFor = (key: string) => DEFAULT_PALETTE[Math.max(agentKeys.indexOf(key), 0) % DEFAULT_PALETTE.length];
  const labelFor = (key: string) => {
    const name = agentLabels[key] ?? key;
    return key.startsWith(WORKFLOW_KEY_PREFIX) ? `Workflow: ${name}` : name;
  };

  return (
    <ThreadRow
      thread={thread}
      unit={unit}
      chartHeight={SESSION_CARD_CHART_HEIGHT}
      maxBinTotal={maxBinTotal}
      perCardHeight={false}
      maxBinCount={maxBinCount}
      agentKeys={agentKeys}
      colorFor={colorFor}
      labelFor={labelFor}
      onSegmentClick={(agentKey) => {
        if (!agentKey.startsWith(WORKFLOW_KEY_PREFIX)) onSelectAgent?.(agentKey);
      }}
      fillWidth
      hugWidth={false}
      collapseEmpty
      colWidthPx={6}
      colGap={1}
      segGap={0}
      colRadius={0}
      segRadius={0}
      frameLiftColor="#e3e3dd"
      activeAgentKey={activeAgentKey}
    />
  );
}
