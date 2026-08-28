// "Usage Analytics" nav panel — one horizontal token-usage bar chart per
// recent Claude Code session, agents stacked as coloured segments.
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
import { useBbNavigate, useRpc, type PluginNavPanelProps, type PluginRpcResult } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ProjectSwitcher, type ProjectSwitcherOption } from "../packages/project-switcher/react";
import { DEFAULT_VIZ_SETTINGS, binTotal, type ThreadEntry } from "../src/core";
import { DEFAULT_PALETTE, ThreadRow, computeDisplayBins } from "./thread-chart";
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
  // Cost bounds in USD as raw input strings — empty means unbounded on that
  // end. Kept as strings (not numbers) so a half-typed "0." or an empty field
  // is a first-class "no bound", never coerced to 0 mid-edit.
  const [costMin, setCostMin] = useState("");
  const [costMax, setCostMax] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [projectFilter, searchQuery, sortMode, costMin, costMax, unit]);

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

  // "Все проекты" (key: "") resets the filter, then one entry per
  // projectOptions — the "Threads" bucket (key: null) is already the last
  // entry there, not duplicated here.
  const switcherOptions = useMemo<ProjectSwitcherOption[]>(
    () => [{ key: "", label: "Все проекты" }, ...projectOptions],
    [projectOptions],
  );

  const filteredSorted = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    // A blank or non-numeric bound is "no bound", never 0 — an empty "от"
    // must not silently drop every free thread.
    const min = Number.parseFloat(costMin);
    const max = Number.parseFloat(costMax);
    let list = threads.filter((t) => {
      if (q && !(t.title + " " + t.session + " " + (t.bbThreadTitle ?? "")).toLowerCase().includes(q)) return false;
      if (projectFilter.size > 0 && !projectFilter.has(projectKeyOf(t))) return false;
      if (Number.isFinite(min) && t.totalCost < min) return false;
      if (Number.isFinite(max) && t.totalCost > max) return false;
      return true;
    });
    if (sortMode === "tokens") list = [...list].sort((a, b) => b.totalTokens - a.totalTokens);
    else if (sortMode === "duration") list = [...list].sort((a, b) => b.durationSec - a.durationSec);
    return list; // "recent" — the server's own order (newest first)
  }, [threads, searchQuery, projectFilter, sortMode, costMin, costMax]);

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
        setSearchQuery(t.searchQuery);
        setProjectFilter(new Set(t.projectFilter));
        setCostMin(t.costMin);
        setCostMax(t.costMax);
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
          threads: {
            unit,
            fillWidth,
            collapseEmpty,
            colWidthPx,
            heightScale,
            colGap,
            segGap,
            colRadius,
            segRadius,
            frameLiftColor,
            agentColors,
            sortMode,
            searchQuery,
            projectFilter: Array.from(projectFilter),
            costMin,
            costMax,
          },
          agentDetail: loadedAgentDetailSectionRef.current,
        })
        .catch(() => {
          // Best-effort persistence — a failed save just means this
          // preference doesn't survive to the next session; nothing in this
          // page depends on the write succeeding.
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [
    vizHydrated,
    unit,
    fillWidth,
    collapseEmpty,
    colWidthPx,
    heightScale,
    colGap,
    segGap,
    colRadius,
    segRadius,
    frameLiftColor,
    agentColors,
    sortMode,
    searchQuery,
    projectFilter,
    costMin,
    costMax,
    rpc,
  ]);

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
          <h1 className="text-lg font-semibold text-foreground">Usage Analytics</h1>
          <p className="text-sm text-muted-foreground">Расход токенов по агентам, слева направо хронологически внутри каждого треда</p>
        </header>

        {/* Один ряд управления: проекты слева, сортировка/поиск/шестерёнка
            справа. Всё остальное (единица времени, геометрия, цвета агентов)
            спрятано под шестерёнку — см. ChartSettingsPopover. Легенды агентов
            в тулбаре больше нет: разбивка по агентам живёт в тултипе столбца. */}
        <section className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-4">
          <ProjectSwitcher
            options={switcherOptions}
            isSelected={(key) => (key === "" ? projectFilter.size === 0 : projectFilter.has(key))}
            onSelect={(key) => {
              if (key === "") {
                setProjectFilter(new Set());
                return;
              }
              setProjectFilter((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              });
            }}
          />

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1" role="group" aria-label="Фильтр по стоимости">
              <span className="text-xs text-muted-foreground">$</span>
              <Input
                type="number"
                min={0}
                step={0.01}
                placeholder="от"
                value={costMin}
                onChange={(e) => setCostMin(e.target.value)}
                className="h-8 w-16 tabular-nums"
                aria-label="Стоимость от, USD"
              />
              <span className="text-xs text-muted-foreground">–</span>
              <Input
                type="number"
                min={0}
                step={0.01}
                placeholder="до"
                value={costMax}
                onChange={(e) => setCostMax(e.target.value)}
                className="h-8 w-16 tabular-nums"
                aria-label="Стоимость до, USD"
              />
            </div>
            <select
              className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
              aria-label="Сортировка"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <Input
              type="text"
              placeholder="По названию или ID сессии"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-52"
            />
            <ChartSettingsPopover
              unit={unit}
              onUnitChange={changeUnit}
              fillWidth={fillWidth}
              onFillWidthChange={setFillWidth}
              collapseEmpty={collapseEmpty}
              onCollapseEmptyChange={setCollapseEmpty}
              colWidthPx={colWidthPx}
              onColWidthPxChange={setColWidthPx}
              heightScale={heightScale}
              onHeightScaleChange={setHeightScale}
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
              agentKeys={agentKeys}
              colorFor={colorFor}
              labelFor={labelFor}
              onAgentColorChange={(key, hex) => setAgentColors((prev) => ({ ...prev, [key]: hex }))}
            />
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
                  onOpenThread={thread.threadId ? () => navigate.toThread(thread.threadId!) : undefined}
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

/**
 * The chart's single settings surface — a gear-triggered popover holding
 * every control that isn't the project filter, sort, or search: time unit,
 * the fill/collapse toggles, width/height, geometry knobs, the frame-lift
 * tint, and each agent's colour. The toolbar legend that used to own those
 * agent colours is gone — the per-agent breakdown now lives in each column's
 * hover tooltip (see ThreadRow). No slider component exists in this design
 * system (see memory/decisions/token-usage-no-slider-use-inputs.md) — number
 * inputs only.
 */
function ChartSettingsPopover({
  unit,
  onUnitChange,
  fillWidth,
  onFillWidthChange,
  collapseEmpty,
  onCollapseEmptyChange,
  colWidthPx,
  onColWidthPxChange,
  heightScale,
  onHeightScaleChange,
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
  agentKeys,
  colorFor,
  labelFor,
  onAgentColorChange,
}: {
  unit: number;
  onUnitChange: (v: number) => void;
  fillWidth: boolean;
  onFillWidthChange: (v: boolean) => void;
  collapseEmpty: boolean;
  onCollapseEmptyChange: (v: boolean) => void;
  colWidthPx: number;
  onColWidthPxChange: (v: number) => void;
  heightScale: number;
  onHeightScaleChange: (v: number) => void;
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
  agentKeys: readonly string[];
  colorFor: (agentKey: string) => string;
  labelFor: (agentKey: string) => string;
  onAgentColorChange: (agentKey: string, hex: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground"
          aria-label="Настройки диаграммы"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70vh] w-72 space-y-3 overflow-y-auto p-3">
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">Единица времени</div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Единица времени">
            {UNIT_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                type="button"
                variant={opt.value === unit ? "default" : "ghost"}
                size="sm"
                aria-pressed={opt.value === unit}
                onClick={() => onUnitChange(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>

        <ToggleField label="Заполнить по ширине" value={fillWidth} onChange={onFillWidthChange} />
        <ToggleField
          label="Схлопнуть пустоты"
          value={collapseEmpty}
          onChange={onCollapseEmptyChange}
          nameOn="Схлопнуть пустоты: Вкл"
          nameOff="Схлопнуть пустоты: Выкл"
        />

        {!fillWidth && (
          <NumberField label="Ширина" ariaLabel="Ширина столбца, пикселей" suffix="px/стб" value={colWidthPx} onChange={onColWidthPxChange} min={1} max={40} step={1} />
        )}
        <NumberField label="Высота" ariaLabel="Масштаб высоты" suffix="×" value={heightScale} onChange={onHeightScaleChange} min={0.3} max={3} step={0.1} />

        <div className="space-y-2 border-t border-border pt-2">
          <div className="text-xs font-medium text-muted-foreground">Геометрия</div>
          <NumberField label="Отступ между столбцами" value={colGap} onChange={onColGapChange} min={0} max={8} step={0.1} />
          <NumberField label="Отступ между сегментами" value={segGap} onChange={onSegGapChange} min={0} max={6} step={0.1} />
          <NumberField label="Скругление столбца" value={colRadius} onChange={onColRadiusChange} min={0} max={8} step={0.1} />
          <NumberField label="Скругление сегмента" value={segRadius} onChange={onSegRadiusChange} min={0} max={8} step={0.1} />
        </div>

        <div className="space-y-1 border-t border-border pt-2">
          <div className="text-xs font-medium text-muted-foreground">Цвет высветления фрейма графика</div>
          <input
            type="color"
            value={frameLiftColor}
            onChange={(e) => onFrameLiftColorChange(e.target.value)}
            className="h-8 w-full cursor-pointer rounded-sm border border-border bg-transparent p-0"
            aria-label="Цвет высветления фрейма графика"
          />
        </div>

        {agentKeys.length > 0 && (
          <div className="space-y-1.5 border-t border-border pt-2">
            <div className="text-xs font-medium text-muted-foreground">Цвета агентов</div>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {agentKeys.map((key) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="inline-block size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: colorFor(key) }} />
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{labelFor(key)}</span>
                  <input
                    type="color"
                    value={colorFor(key)}
                    onChange={(e) => onAgentColorChange(key, e.target.value)}
                    className="h-6 w-8 shrink-0 cursor-pointer rounded-sm border border-border bg-transparent p-0"
                    aria-label={`Цвет агента ${labelFor(key)}`}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * A labelled Вкл/Выкл toggle pair. By default the two buttons' accessible
 * names are just "Вкл"/"Выкл"; pass nameOn/nameOff when two toggles share the
 * same popover so their buttons stay individually addressable (a bare "Выкл"
 * would otherwise match both).
 */
function ToggleField({
  label,
  value,
  onChange,
  nameOn,
  nameOff,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  nameOn?: string;
  nameOff?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex gap-1" role="group" aria-label={label}>
        <Button type="button" variant={value ? "default" : "ghost"} size="sm" aria-pressed={value} aria-label={nameOn} onClick={() => onChange(true)}>
          Вкл
        </Button>
        <Button type="button" variant={!value ? "default" : "ghost"} size="sm" aria-pressed={!value} aria-label={nameOff} onClick={() => onChange(false)}>
          Выкл
        </Button>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix = "px",
  ariaLabel,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  /** Overrides the field's accessible name when it must differ from the visible label (e.g. "Ширина" shown, "Ширина столбца, пикселей" announced). */
  ariaLabel?: string;
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
          aria-label={ariaLabel ?? label}
        />
        <span className="shrink-0 text-xs text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );
}
