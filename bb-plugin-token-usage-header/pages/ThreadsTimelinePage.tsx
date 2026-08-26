// "Лента последних тредов" nav panel — one horizontal token-usage bar chart
// per recent Claude Code session, agents stacked as coloured segments.
// Ports prototype/threads-timeline.html into real data/components; see that
// file for the approved visual reference.
//
// The RPC (`threadsTimeline`) already returns one slice (`limit` sessions,
// pre-binned to `unit` seconds); everything below it — project filter,
// search, sort, and the render-time page growth — works client-side over
// that slice, per the task's data-flow split. Growing past the fetched
// slice re-calls the RPC with a bigger `limit` (capped at the contract's
// max of 100).
//
// This is the feed (empty-subPath) sub-view of the plugin's one
// "threads-timeline" nav panel — app.tsx renders it when subPath is "",
// AgentTimelinePage.tsx otherwise (see that file's module doc comment).
// Segment clicks navigate to the same panel with a non-empty subPath
// carrying only `session` (this page never has a BB `threadId`) — see
// pages/AgentTimelinePage.tsx's module doc comment for why that sub-view
// then can't fetch real data for such a link without one.
import { useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { useBbNavigate, useRpc, type PluginNavPanelProps, type PluginRpcResult } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { DEFAULT_VIZ_SETTINGS, binTotal, formatTokenCount, type ThreadEntry, type TimelineBin } from "../src/core";
import { THREADS_TIMELINE_PANEL_PATH, buildAgentDetailSubPath } from "./AgentTimelinePage";

/**
 * Default lift colour follows the theme's own `--foreground` token (read
 * live at mount, not hardcoded) — mirrors prototype/threads-timeline.html's
 * own approach. Falls back to that prototype's known dark-theme value if
 * the variable isn't resolvable yet (e.g. under jsdom in tests, or before
 * the host's stylesheet has applied) — not a fabricated colour, just the
 * one already used as this file's own fallback reference.
 */
function readForegroundHex(): string {
  if (typeof document === "undefined") return "#e3e3dd";
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--foreground").trim();
  return raw || "#e3e3dd";
}

/** Fixed, subtle alpha for the chart frame's lift tint — only the hue is user-configurable (native `<input type="color">` has no alpha channel). */
const FRAME_LIFT_ALPHA = 0.05;

function hexToRgba(hex: string, alpha: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.substring(0, 2), 16) || 0;
  const g = parseInt(h.substring(2, 4), 16) || 0;
  const b = parseInt(h.substring(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${alpha})`;
}

const UNIT_OPTIONS: ReadonlyArray<{ label: string; value: number }> = [
  { label: "30s", value: 30 },
  { label: "1m", value: 60 },
  { label: "5m", value: 300 },
  { label: "15m", value: 900 },
  { label: "1h", value: 3600 },
];

const SORT_OPTIONS: ReadonlyArray<{ label: string; value: SortMode }> = [
  { label: "Последние", value: "recent" },
  { label: "По токенам (убыв.)", value: "tokens" },
  { label: "По длительности (убыв.)", value: "duration" },
];

type SortMode = "recent" | "tokens" | "duration";

/**
 * One entry in the project picker. `key: null` is the "Threads" bucket —
 * sessions with `bbProjectName === null` (no matching BB thread) — kept as
 * the real `null` rather than a sentinel string, since `projectFilter` is
 * transient client-side state (never serialized over rpc or persisted), so
 * there is no format constraint pushing towards a string-only key.
 */
interface ProjectOption {
  key: string | null;
  label: string;
}

function projectKeyOf(thread: ThreadEntry): string | null {
  return thread.bbProjectName;
}

const INITIAL_LIMIT = 20;
const LIMIT_STEP = 20;
/** Mirrors the RPC input's `z.number().int().min(1).max(100)` in server.ts. */
const MAX_LIMIT = 100;
const PAGE_SIZE = 12;
const BASE_CHART_HEIGHT = 72;
/** Floor for the graph's own width when fillWidth is off (colWidthPx * 0 bins would otherwise collapse it). */
const MIN_GRAPH_WIDTH_PX = 4;

/** Cycled by first-seen order (main first, then by total spend) — a free choice per module doc comment: agent colour is chart data, not UI chrome. */
const DEFAULT_PALETTE = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4", "#eab308", "#14b8a6", "#ec4899", "#84cc16"];

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
interface DisplayBin {
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
function computeDisplayBins(bins: readonly TimelineBin[], collapseEmpty: boolean): DisplayBin[] {
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

export function ThreadsTimelinePage(_props: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();

  const [unit, setUnit] = useState<number>(60);
  const [limit, setLimit] = useState(INITIAL_LIMIT);
  const [threads, setThreads] = useState<ThreadEntry[]>([]);
  // agentId (bins[].agents[].key, "main" for the main agent) -> human-readable
  // label built server-side by threads_timeline.py from the subagent's
  // meta.json. Display-only — colour/click/agentColors keys stay the raw
  // agentId, this map never substitutes into them.
  const [agentLabels, setAgentLabels] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    // A fresh unit re-bins server-side — stale rows would show bars sized
    // for the old bin width, so only that case blanks the list. Growing
    // `limit` alone (easy-load) keeps the current rows on screen while the
    // bigger slice loads.
    if (threads.length === 0) setPhase("loading");
    rpc.call("threadsTimeline", { limit, unit }).then(
      (result) => {
        if (!mountedRef.current || requestIdRef.current !== requestId) return;
        if (result.status === "ready") {
          setThreads(result.threads);
          setAgentLabels(result.agentLabels);
          setPhase("ready");
        } else {
          setErrorMessage(result.message);
          setPhase("error");
        }
      },
      (err: unknown) => {
        if (!mountedRef.current || requestIdRef.current !== requestId) return;
        setErrorMessage(err instanceof Error ? err.message : "Не удалось получить сводную ленту тредов.");
        setPhase("error");
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc, unit, limit]);

  function changeUnit(next: number) {
    if (next === unit) return;
    setUnit(next);
    setLimit(INITIAL_LIMIT);
    setThreads([]);
  }

  // --- Visual scale controls (numeric inputs, no slider — see memory/decisions/token-usage-no-slider-use-inputs.md). ---
  const [fillWidth, setFillWidth] = useState(true);
  // true = consecutive empty bins render as one collapsed gap column instead
  // of one column per empty bin — see computeDisplayBins above.
  const [collapseEmpty, setCollapseEmpty] = useState(false);
  const [colWidthPx, setColWidthPx] = useState(6);
  const [heightScale, setHeightScale] = useState(1);

  // --- Chart geometry (numeric px settings behind the gear popover, next to
  // the legend) — data geometry, not UI chrome, so free px values are fine
  // here (same reasoning as prototype/threads-timeline.html's state.colGap
  // et al.). ---
  const [colGap, setColGap] = useState(1);
  const [segGap, setSegGap] = useState(0);
  const [colRadius, setColRadius] = useState(0);
  const [segRadius, setSegRadius] = useState(0);
  const [frameLiftColor, setFrameLiftColor] = useState<string>(() => readForegroundHex());

  // --- Filter/sort/search — client-side over the fetched slice. ---
  const [projectFilter, setProjectFilter] = useState<Set<string | null>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [projectFilter, searchQuery, sortMode, unit]);

  // Real BB projects (bbProjectName) sorted alphabetically, plus a trailing
  // "Threads" bucket for sessions with no BB thread match (bbProjectName
  // null) — the raw transcript-directory slug (`project`) is no longer
  // shown at all; it isn't a real BB project and confused the old picker.
  const projectOptions = useMemo<ProjectOption[]>(() => {
    const names = new Set<string>();
    let hasThreadsBucket = false;
    threads.forEach((t) => {
      if (t.bbProjectName) names.add(t.bbProjectName);
      else hasThreadsBucket = true;
    });
    const options: ProjectOption[] = Array.from(names)
      .sort()
      .map((name) => ({ key: name, label: name }));
    if (hasThreadsBucket) options.push({ key: null, label: "Threads" });
    return options;
  }, [threads]);

  const filteredSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = threads.filter((t) => {
      if (q && !(t.title + " " + t.session + " " + (t.bbThreadTitle ?? "")).toLowerCase().includes(q)) return false;
      if (projectFilter.size > 0 && !projectFilter.has(projectKeyOf(t))) return false;
      return true;
    });
    if (sortMode === "tokens") list = [...list].sort((a, b) => b.totalTokens - a.totalTokens);
    else if (sortMode === "duration") list = [...list].sort((a, b) => b.durationSec - a.durationSec);
    return list; // "recent" — the server's own order (newest first)
  }, [threads, searchQuery, projectFilter, sortMode]);

  const visibleThreads = filteredSorted.slice(0, visibleCount);

  // --- Easy-load: grow the rendered window first, then the fetched slice. ---
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    // jsdom has no IntersectionObserver — scroll-triggered growth simply
    // doesn't fire under test, which is fine: tests assert the initial slice.
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (visibleCount < filteredSorted.length) {
          setVisibleCount((vc) => Math.min(vc + PAGE_SIZE, filteredSorted.length));
        } else if (phase === "ready" && limit < MAX_LIMIT) {
          setLimit((l) => Math.min(l + LIMIT_STEP, MAX_LIMIT));
        }
      },
      { root: null, rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visibleCount, filteredSorted.length, phase, limit]);

  // --- Legend / agent colours. ---
  const agentKeys = useMemo(() => {
    const totals = new Map<string, number>();
    threads.forEach((t) => t.bins.forEach((bin) => bin.agents.forEach((a) => totals.set(a.key, (totals.get(a.key) ?? 0) + a.total))));
    return Array.from(totals.keys()).sort((a, b) => {
      if (a === "main") return -1;
      if (b === "main") return 1;
      return (totals.get(b) ?? 0) - (totals.get(a) ?? 0);
    });
  }, [threads]);
  const [agentColors, setAgentColors] = useState<Record<string, string>>({});
  function colorFor(agentKey: string): string {
    const existing = agentColors[agentKey];
    if (existing) return existing;
    const index = agentKeys.indexOf(agentKey);
    return DEFAULT_PALETTE[(index < 0 ? 0 : index) % DEFAULT_PALETTE.length];
  }
  /** Display-only name for an agentId — colour/click/agentColors keys stay the raw id, only the shown text changes. */
  function labelFor(agentKey: string): string {
    return agentLabels[agentKey] ?? agentKey;
  }

  // --- Viz-settings persistence (bb.storage.kv via loadVizSettings/
  // saveVizSettings — see memory/decisions/token-usage-viz-settings-persist-kv.md).
  // This page owns only the `threads` section (unit, fillWidth, colWidthPx,
  // heightScale, colGap, segGap, colRadius, segRadius, frameLiftColor,
  // agentColors, sortMode — deliberately NOT projectFilter/searchQuery,
  // transient query state per the decision doc); the sibling `agentDetail`
  // section belongs to AgentTimelinePage.tsx. A save always sends the FULL
  // VizSettings object (the RPC schema requires both sections), so whatever
  // `agentDetail` this page last loaded is held in a ref and echoed back
  // unchanged on every save — this page never edits it.
  const loadedAgentDetailSectionRef = useRef(DEFAULT_VIZ_SETTINGS.agentDetail);
  const [vizHydrated, setVizHydrated] = useState(false);
  const skipNextSaveRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    rpc.call("loadVizSettings", {}).then(
      (settings) => {
        if (cancelled || !mountedRef.current) return;
        skipNextSaveRef.current = true;
        loadedAgentDetailSectionRef.current = settings.agentDetail;
        const t = settings.threads;
        setUnit(t.unit);
        setFillWidth(t.fillWidth);
        setCollapseEmpty(t.collapseEmpty);
        setColWidthPx(t.colWidthPx);
        setHeightScale(t.heightScale);
        setColGap(t.colGap);
        setSegGap(t.segGap);
        setColRadius(t.colRadius);
        setSegRadius(t.segRadius);
        setFrameLiftColor(t.frameLiftColor);
        setAgentColors(t.agentColors);
        setSortMode(t.sortMode);
        setVizHydrated(true);
      },
      () => {
        // Load failure: keep the schema's own defaults already in state,
        // just mark hydrated so later edits still persist instead of never
        // autosaving.
        if (!cancelled && mountedRef.current) setVizHydrated(true);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc]);
  useEffect(() => {
    if (!vizHydrated) return;
    if (skipNextSaveRef.current) {
      // The hydration above just applied the exact values being saved here
      // — skip this one run so mounting doesn't immediately echo the load
      // back as a redundant write.
      skipNextSaveRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      rpc
        .call("saveVizSettings", {
          threads: { unit, fillWidth, collapseEmpty, colWidthPx, heightScale, colGap, segGap, colRadius, segRadius, frameLiftColor, agentColors, sortMode },
          agentDetail: loadedAgentDetailSectionRef.current,
        })
        .catch(() => {
          // Best-effort persistence — a failed save just means this
          // preference doesn't survive to the next session; nothing in this
          // page depends on the write succeeding.
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [vizHydrated, unit, fillWidth, collapseEmpty, colWidthPx, heightScale, colGap, segGap, colRadius, segRadius, frameLiftColor, agentColors, sortMode, rpc]);

  const maxBinTotal = useMemo(() => {
    let max = 0;
    for (const t of visibleThreads) for (const bin of t.bins) max = Math.max(max, binTotal(bin));
    return max;
  }, [visibleThreads]);
  // DISPLAYED column count of the longest visible thread — after collapseEmpty
  // folds runs of empty bins into single gap columns, not the raw bin count.
  // When fillWidth is on, every thread's columns take width 100%/maxBinCount,
  // so all columns are the SAME width across threads and only the longest
  // thread fills the row; shorter threads are proportionally narrower (fewer
  // equal-width columns), not stretched. Keying width off the raw bin count
  // here would make columns a different width than what ThreadRow itself
  // renders (it collapses the same way) — both must agree on "how many
  // columns", so this uses computeDisplayBins too.
  const maxBinCount = useMemo(() => {
    let max = 1;
    for (const t of visibleThreads) max = Math.max(max, computeDisplayBins(t.bins, collapseEmpty).length);
    return max;
  }, [visibleThreads, collapseEmpty]);
  const chartHeight = BASE_CHART_HEIGHT * heightScale;

  function openAgentDetail(agentKey: string, session: string, fromIso: string, toIso: string) {
    navigate.toPluginPanel(THREADS_TIMELINE_PANEL_PATH, {
      subPath: buildAgentDetailSubPath({ agent: agentKey, session, from: fromIso, to: toIso }),
    });
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-6 px-6 py-8">
        <header className="space-y-1">
          <h1 className="text-lg font-semibold text-foreground">Лента последних тредов</h1>
          <p className="text-sm text-muted-foreground">Расход токенов по агентам, слева направо хронологически внутри каждого треда</p>
        </header>

        <section className="space-y-2.5 border-b border-border pb-4">
          <div className="text-sm font-semibold text-foreground">Проекты</div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={projectFilter.size === 0 ? "default" : "outline"}
              size="sm"
              aria-pressed={projectFilter.size === 0}
              onClick={() => setProjectFilter(new Set())}
            >
              Все проекты
            </Button>
            {projectOptions.map((opt) => (
              <Button
                key={opt.key ?? "—threads—"}
                type="button"
                variant={projectFilter.has(opt.key) ? "default" : "outline"}
                size="sm"
                aria-pressed={projectFilter.has(opt.key)}
                onClick={() =>
                  setProjectFilter((prev) => {
                    const next = new Set(prev);
                    if (next.has(opt.key)) next.delete(opt.key);
                    else next.add(opt.key);
                    return next;
                  })
                }
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </section>

        <section className="space-y-3 border-b border-border pb-4">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Единица времени</div>
              <div className="flex gap-1" role="group" aria-label="Единица времени">
                {UNIT_OPTIONS.map((opt) => (
                  <Button
                    key={opt.value}
                    type="button"
                    variant={opt.value === unit ? "default" : "ghost"}
                    size="sm"
                    aria-pressed={opt.value === unit}
                    onClick={() => changeUnit(opt.value)}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Заполнить по ширине</div>
              <div className="flex gap-1" role="group" aria-label="Заполнить по ширине">
                <Button type="button" variant={fillWidth ? "default" : "ghost"} size="sm" aria-pressed={fillWidth} onClick={() => setFillWidth(true)}>
                  Вкл
                </Button>
                <Button type="button" variant={!fillWidth ? "default" : "ghost"} size="sm" aria-pressed={!fillWidth} onClick={() => setFillWidth(false)}>
                  Выкл
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Схлопнуть пустоты</div>
              {/*
               * aria-label per button (not the visible "Вкл"/"Выкл" text alone)
               * — the "Заполнить по ширине" toggle above already owns those
               * exact accessible names; without a distinguishing aria-label,
               * `getByRole("button", { name: "Выкл" })` in existing tests
               * would start matching two buttons and throw.
               */}
              <div className="flex gap-1" role="group" aria-label="Схлопнуть пустоты">
                <Button
                  type="button"
                  variant={collapseEmpty ? "default" : "ghost"}
                  size="sm"
                  aria-pressed={collapseEmpty}
                  aria-label="Схлопнуть пустоты: Вкл"
                  onClick={() => setCollapseEmpty(true)}
                >
                  Вкл
                </Button>
                <Button
                  type="button"
                  variant={!collapseEmpty ? "default" : "ghost"}
                  size="sm"
                  aria-pressed={!collapseEmpty}
                  aria-label="Схлопнуть пустоты: Выкл"
                  onClick={() => setCollapseEmpty(false)}
                >
                  Выкл
                </Button>
              </div>
            </div>
            {!fillWidth && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">Ширина</div>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min={1}
                    max={40}
                    step={1}
                    value={colWidthPx}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isNaN(v)) setColWidthPx(v);
                    }}
                    className="w-16 tabular-nums"
                    aria-label="Ширина столбца, пикселей"
                  />
                  <span className="shrink-0 text-xs text-muted-foreground">px/стб</span>
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Высота</div>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={0.3}
                  max={3}
                  step={0.1}
                  value={heightScale}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isNaN(v)) setHeightScale(v);
                  }}
                  className="w-16 tabular-nums"
                  aria-label="Масштаб высоты"
                />
                <span className="shrink-0 text-xs text-muted-foreground">×</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border pt-3">
            <div className="flex flex-wrap items-center gap-2">
              {/* Compact — a session with many subagents can carry dozens of
                  agent keys; a flat wall of chips would push the whole
                  toolbar off-screen. Capped height + scroll instead of
                  unbounded wrap, same escape hatch as a long thread list. */}
              <div className="flex max-h-16 max-w-[28rem] flex-wrap content-start gap-x-3 gap-y-1 overflow-y-auto text-xs text-muted-foreground">
                {agentKeys.map((key) => (
                  <LegendItem
                    key={key}
                    agentKey={key}
                    label={labelFor(key)}
                    color={colorFor(key)}
                    onChange={(hex) => setAgentColors((prev) => ({ ...prev, [key]: hex }))}
                  />
                ))}
              </div>
              <GeometryPopoverButton
                colGap={colGap}
                onColGapChange={setColGap}
                segGap={segGap}
                onSegGapChange={setSegGap}
                colRadius={colRadius}
                onColRadiusChange={setColRadius}
                segRadius={segRadius}
                onSegRadiusChange={setSegRadius}
                frameLiftColor={frameLiftColor}
                onFrameLiftColorChange={setFrameLiftColor}
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Сортировка</div>
              <select
                className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-[220px] flex-1 space-y-1.5">
              <div className="text-xs font-medium text-muted-foreground">Поиск</div>
              <Input
                type="text"
                placeholder="По названию или ID сессии"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="max-w-xs"
              />
            </div>
          </div>
        </section>

        {phase === "loading" && <p className="text-sm text-muted-foreground">Загрузка…</p>}
        {phase === "error" && <p className="text-sm text-destructive">{errorMessage}</p>}

        {phase !== "loading" && phase !== "error" && (
          <section className="pb-2">
            <div className="space-y-4">
              {visibleThreads.map((thread) => (
                <ThreadRow
                  key={thread.session}
                  thread={thread}
                  unit={unit}
                  chartHeight={chartHeight}
                  maxBinTotal={maxBinTotal}
                  maxBinCount={maxBinCount}
                  agentKeys={agentKeys}
                  colorFor={colorFor}
                  labelFor={labelFor}
                  onSegmentClick={openAgentDetail}
                  fillWidth={fillWidth}
                  collapseEmpty={collapseEmpty}
                  colWidthPx={colWidthPx}
                  colGap={colGap}
                  segGap={segGap}
                  colRadius={colRadius}
                  segRadius={segRadius}
                  frameLiftColor={frameLiftColor}
                />
              ))}
            </div>
            <div ref={sentinelRef} className="pt-4 text-center text-xs text-subtle-foreground">
              {filteredSorted.length === 0
                ? "Треды не найдены"
                : visibleCount < filteredSorted.length || (phase === "ready" && limit < MAX_LIMIT && threads.length === limit)
                  ? "Загрузка…"
                  : `Показаны все ${filteredSorted.length} тредов`}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function LegendItem({
  agentKey,
  label,
  color,
  onChange,
}: {
  agentKey: string;
  /** Human-readable display text (agentLabels[agentKey] ?? agentKey) — agentKey itself stays the colour/click identity. */
  label: string;
  color: string;
  onChange: (hex: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex max-w-[9rem] cursor-pointer items-center gap-1.5 rounded-sm px-1 py-0.5 hover:bg-state-hover"
          title={`Выбрать цвет для ${label}`}
        >
          <span className="inline-block size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
          <span className="truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 space-y-2 p-2">
        <div className="truncate text-xs font-medium text-popover-foreground">Цвет: {label}</div>
        <input
          type="color"
          value={color}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-full cursor-pointer rounded-sm border border-border bg-transparent p-0"
          aria-label={`Цвет агента ${label}`}
        />
      </PopoverContent>
    </Popover>
  );
}

function ThreadRow({
  thread,
  unit,
  chartHeight,
  maxBinTotal,
  maxBinCount,
  agentKeys,
  colorFor,
  labelFor,
  onSegmentClick,
  fillWidth,
  collapseEmpty,
  colWidthPx,
  colGap,
  segGap,
  colRadius,
  segRadius,
  frameLiftColor,
}: {
  thread: ThreadEntry;
  unit: number;
  chartHeight: number;
  maxBinTotal: number;
  /** DISPLAYED column count of the longest visible thread (after collapseEmpty folding — see computeDisplayBins) — drives the uniform column width when fillWidth is on. */
  maxBinCount: number;
  agentKeys: readonly string[];
  colorFor: (agentKey: string) => string;
  /** Human-readable display text for an agentId (agentLabels[key] ?? key) — used only in the tooltip text, never as a key. */
  labelFor: (agentKey: string) => string;
  onSegmentClick: (agentKey: string, session: string, fromIso: string, toIso: string) => void;
  /** true = bin columns stretch to share the graph's width equally (flex-1); false = each bin column is a fixed colWidthPx wide. */
  fillWidth: boolean;
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
}) {
  const threadEndMs = Date.parse(thread.end);

  // Названия из bb.sdk (bbThreadTitle, см. threads-timeline-service.ts) — не
  // сырой `title` из threads_timeline.py, который всегда равен session.
  // Нет матча с тредом BB (бакет «Threads») — короткий id сессии вместо
  // пустоты; полный session остаётся в подсказке, а не дублируется в шапке.
  const headerTitle = thread.bbThreadTitle ?? thread.session.slice(0, 8);
  const headerTooltip = thread.bbThreadTitle ? `${thread.bbThreadTitle}\n${thread.session}` : thread.session;

  // Карточка всегда полной ширины контейнера, независимо от длительности
  // треда или числа бинов — раньше ширина карточки была пропорциональна
  // длительности (widthFractions), из-за чего короткие треды давали крошечные
  // стянутые карточки, а длинные — карточки шире ленты. Длительность/число
  // бинов теперь влияют только на сам график ВНУТРИ карточки постоянной
  // ширины: при fillWidth=Вкл график занимает 100% карточки (колонки flex-1),
  // при fillWidth=Выкл колонки имеют фиксированную colWidthPx и, если их
  // суммарная ширина больше карточки, скроллятся внутри неё — через
  // overflow-x-auto на обёртке графика, никогда наружу через карточку.
  // Displayed columns, not raw bins — collapseEmpty folds runs of empty bins
  // into one gap column each (see computeDisplayBins); binCount/graphWidthPx
  // below size the graph off however many columns are actually rendered.
  const displayBins = useMemo(() => computeDisplayBins(thread.bins, collapseEmpty), [thread.bins, collapseEmpty]);
  const binCount = displayBins.length;
  const graphWidthPx = fillWidth
    ? undefined
    : Math.max(binCount * colWidthPx + Math.max(binCount - 1, 0) * colGap, MIN_GRAPH_WIDTH_PX);

  return (
    <div className="w-full space-y-2 rounded-md border border-border p-3" style={{ backgroundColor: hexToRgba(frameLiftColor, FRAME_LIFT_ALPHA) }}>
      <div className="flex items-baseline justify-between gap-3 overflow-hidden text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={headerTooltip}>
          {headerTitle}
        </span>
        <span className="ml-auto shrink-0 tabular-nums">
          {fmtDuration(thread.durationSec)} · {formatTokenCount(thread.totalTokens)} токенов
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

            const binStartMs = Date.parse(bin.t);
            const binEndMs = Number.isNaN(threadEndMs) ? binStartMs + unit * 1000 : Math.min(binStartMs + unit * 1000, threadEndMs);
            const total = binTotal(bin);
            const dispHeight = maxBinTotal > 0 ? Math.max((total / maxBinTotal) * chartHeight, 2) : 2;
            const timeLabel = `${fmtClock(bin.t)}–${fmtClock(new Date(binEndMs).toISOString())}`;
            const ordered = agentKeys.filter((key) => bin.agents.some((a) => a.key === key)).map((key) => bin.agents.find((a) => a.key === key)!);

            return (
              <div key={binIndex} className={colClassName} style={colStyle}>
                <div
                  className="absolute bottom-0 flex w-full flex-col-reverse overflow-hidden"
                  style={{ height: dispHeight, borderRadius: colRadius, gap: segGap }}
                >
                  {ordered.map((a) => {
                    const segHeight = (a.total / total) * dispHeight;
                    return (
                      <button
                        key={a.key}
                        type="button"
                        className="block w-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        style={{ height: Math.max(segHeight, 1), backgroundColor: colorFor(a.key), borderRadius: segRadius }}
                        title={`${headerTitle} · ${thread.session}\n${timeLabel}\n${labelFor(a.key)}: ${formatTokenCount(a.total)} токенов`}
                        onClick={() => onSegmentClick(a.key, thread.session, bin.t, new Date(binEndMs).toISOString())}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Gear-triggered popover for the four numeric geometry knobs plus the frame
 * lift colour — placed next to the legend (per task owner), unlike
 * prototype/threads-timeline.html's original spot in row 1 next to the
 * height control. No slider component exists in this design system (see
 * memory/decisions/token-usage-no-slider-use-inputs.md) — number inputs
 * only, same as the width/height controls above.
 */
function GeometryPopoverButton({
  colGap,
  onColGapChange,
  segGap,
  onSegGapChange,
  colRadius,
  onColRadiusChange,
  segRadius,
  onSegRadiusChange,
  frameLiftColor,
  onFrameLiftColorChange,
}: {
  colGap: number;
  onColGapChange: (v: number) => void;
  segGap: number;
  onSegGapChange: (v: number) => void;
  colRadius: number;
  onColRadiusChange: (v: number) => void;
  segRadius: number;
  onSegRadiusChange: (v: number) => void;
  frameLiftColor: string;
  onFrameLiftColorChange: (hex: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground"
          aria-label="Геометрия и высветление диаграммы"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3 p-3">
        <div className="text-xs font-medium text-popover-foreground">Геометрия диаграммы</div>
        <GeometryNumberField label="Отступ между столбцами" value={colGap} onChange={onColGapChange} min={0} max={8} step={0.1} />
        <GeometryNumberField label="Отступ между сегментами" value={segGap} onChange={onSegGapChange} min={0} max={6} step={0.1} />
        <GeometryNumberField label="Скругление столбца" value={colRadius} onChange={onColRadiusChange} min={0} max={8} step={0.1} />
        <GeometryNumberField label="Скругление сегмента" value={segRadius} onChange={onSegRadiusChange} min={0} max={8} step={0.1} />
        <div className="space-y-1 border-t border-border pt-2">
          <div className="text-xs text-muted-foreground">Цвет высветления фрейма графика</div>
          <input
            type="color"
            value={frameLiftColor}
            onChange={(e) => onFrameLiftColorChange(e.target.value)}
            className="h-8 w-full cursor-pointer rounded-sm border border-border bg-transparent p-0"
            aria-label="Цвет высветления фрейма графика"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function GeometryNumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isNaN(v)) onChange(v);
          }}
          className="w-16 tabular-nums"
          aria-label={label}
        />
        <span className="shrink-0 text-xs text-muted-foreground">px</span>
      </div>
    </div>
  );
}
