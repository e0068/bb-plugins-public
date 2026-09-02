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
// Chart geometry/behaviour (time unit, fill/hug width, collapse-empty,
// column width, height scale/mode, gaps, radii, frame-lift colour, content
// width) used to live behind this page's own gear popover, persisted in
// bb.storage.kv. It now lives on the plugin's native Settings page (Tools →
// plugin detail, via bb.settings.define — see src/core/gear-settings.ts and
// memory/decisions/token-usage-gear-to-native-settings.md) and is read here
// live via `useSettings()`; this page no longer writes those fields at all.
// Only per-agent legend colours (agentColors, a dynamic agent-id → hex map
// that can't be a declared setting) remain in this page's own small popover,
// still kv-persisted alongside sort/search/filter state.
//
// This is the feed (empty-subPath) sub-view of the plugin's one
// "threads-timeline" nav panel — app.tsx renders it when subPath is "",
// AgentTimelinePage.tsx otherwise (see that file's module doc comment).
// Segment clicks navigate to the same panel with a non-empty subPath
// carrying only `session` (this page never has a BB `threadId`) — see
// pages/AgentTimelinePage.tsx's module doc comment for why that sub-view
// then can't fetch real data for such a link without one.
import { useEffect, useMemo, useRef, useState } from "react";
import { useBbNavigate, useRpc, useSettings, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DEFAULT_VIZ_SETTINGS, binTotal, parseGearSettings, type ThreadEntry } from "../src/core";
import { DEFAULT_PALETTE, ThreadRow, computeDisplayBins } from "./thread-chart";
import { THREADS_TIMELINE_PANEL_PATH, buildAgentDetailSubPath } from "./AgentTimelinePage";

const SORT_OPTIONS: ReadonlyArray<{ label: string; value: SortMode }> = [
  { label: "Latest", value: "recent" },
  { label: "By tokens (desc.)", value: "tokens" },
  { label: "By duration (desc.)", value: "duration" },
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

  // Chart geometry/behaviour — declared settings, read live, never written
  // from here (see this file's module doc comment). `gear.unit` in
  // particular drives the RPC's bucket width below.
  const settingsState = useSettings();
  const gear = useMemo(() => parseGearSettings(settingsState.values), [settingsState.values]);

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

  // A changed bucket width re-bins server-side — stale rows would show bars
  // sized for the old bin width, so a unit change blanks the list and resets
  // the fetched slice back to the first page. Runs on mount too (a harmless
  // no-op there: both are already at their initial values).
  useEffect(() => {
    setLimit(INITIAL_LIMIT);
    setThreads([]);
  }, [gear.unit]);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    if (threads.length === 0) setPhase("loading");
    rpc.call("threadsTimeline", { limit, unit: gear.unit }).then(
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
        setErrorMessage(err instanceof Error ? err.message : "Failed to fetch the threads summary feed.");
        setPhase("error");
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc, gear.unit, limit]);

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
  }, [projectFilter, searchQuery, sortMode, costMin, costMax, gear.unit]);

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
    // A blank or non-numeric bound is "no bound", never 0 — an empty "from"
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

  // --- Remaining viz-settings persistence (bb.storage.kv via
  // loadVizSettings/saveVizSettings — see memory/decisions/
  // token-usage-viz-settings-persist-kv.md and memory/decisions/
  // token-usage-gear-to-native-settings.md). This page owns only the
  // `threads` section's agentColors/sortMode/searchQuery/projectFilter/
  // costMin/costMax — everything else that USED to live here (geometry,
  // fill/hug width, content width, collapse-empty) is now a
  // bb.settings.define field read via `gear` above, not part of this blob.
  // The sibling `agentDetail` section belongs to AgentTimelinePage.tsx; a
  // save always sends the FULL VizSettings object (the RPC schema requires
  // both sections), so whatever `agentDetail` this page last loaded is held
  // in a ref and echoed back unchanged on every save.
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
  }, [vizHydrated, agentColors, sortMode, searchQuery, projectFilter, costMin, costMax, rpc]);

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
    for (const t of visibleThreads) max = Math.max(max, computeDisplayBins(t.bins, gear.collapseEmpty).length);
    return max;
  }, [visibleThreads, gear.collapseEmpty]);
  const chartHeight = BASE_CHART_HEIGHT * gear.heightScale;

  function openAgentDetail(agentKey: string, session: string, fromIso: string, toIso: string) {
    navigate.toPluginPanel(THREADS_TIMELINE_PANEL_PATH, {
      subPath: buildAgentDetailSubPath({ agent: agentKey, session, from: fromIso, to: toIso }),
    });
  }

  // Clicking anywhere on the card navigates to the session's internal page —
  // main-agent detail with no time window (unlike clicking a segment).
  function openSession(session: string) {
    navigate.toPluginPanel(THREADS_TIMELINE_PANEL_PATH, {
      subPath: buildAgentDetailSubPath({ agent: "main", session }),
    });
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Width of the whole Usage Analytics area: full window width, or
          centered with a contentMaxWidthPx ceiling — both fields are
          configured in Tools → Usage Analytics (Settings), not here. */}
      <div className="mx-auto space-y-6 px-6 py-8" style={{ maxWidth: gear.contentFullWidth ? "none" : gear.contentMaxWidthPx }}>
        <header className="space-y-1">
          <h1 className="text-lg font-semibold text-foreground">Usage Analytics</h1>
          <p className="text-sm text-muted-foreground">Token usage by agent, left to right chronologically within each thread</p>
        </header>

        {/* One control row: projects on the left, sort/search/agent colors on
            the right. Time unit, geometry, and the rest of the chart's visuals
            are configured on the plugin's Settings page (Tools → Usage
            Analytics) — see the module doc comment above. There's no agent
            legend in the toolbar: the per-agent breakdown lives in a column's
            tooltip, and their colors live in the AgentColorsPopover. */}
        <section className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={projectFilter.size === 0 ? "default" : "outline"}
              size="sm"
              aria-pressed={projectFilter.size === 0}
              onClick={() => setProjectFilter(new Set())}
            >
              All projects
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

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1" role="group" aria-label="Cost filter">
              <span className="text-xs text-muted-foreground">$</span>
              <Input
                type="number"
                min={0}
                step={0.01}
                placeholder="from"
                value={costMin}
                onChange={(e) => setCostMin(e.target.value)}
                className="h-8 w-16 tabular-nums"
                aria-label="Cost from, USD"
              />
              <span className="text-xs text-muted-foreground">–</span>
              <Input
                type="number"
                min={0}
                step={0.01}
                placeholder="to"
                value={costMax}
                onChange={(e) => setCostMax(e.target.value)}
                className="h-8 w-16 tabular-nums"
                aria-label="Cost to, USD"
              />
            </div>
            <select
              className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
              aria-label="Sorting"
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
              placeholder="By name or session ID"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-52"
            />
            <AgentColorsPopover
              agentKeys={agentKeys}
              colorFor={colorFor}
              labelFor={labelFor}
              onAgentColorChange={(key, hex) => setAgentColors((prev) => ({ ...prev, [key]: hex }))}
            />
          </div>
        </section>

        {phase === "loading" && <p className="text-sm text-muted-foreground">Loading…</p>}
        {phase === "error" && <p className="text-sm text-destructive">{errorMessage}</p>}

        {phase !== "loading" && phase !== "error" && (
          <section className="pb-2">
            {/* In hug mode, cards are sized to their own chart and laid out as
                a wrapping tile grid; otherwise it's a full-width vertical
                stack. */}
            <div className={gear.hugWidth && !gear.fillWidthFeed ? "flex flex-wrap items-start gap-4" : "space-y-4"}>
              {visibleThreads.map((thread) => (
                <ThreadRow
                  key={thread.session}
                  thread={thread}
                  unit={gear.unit}
                  chartHeight={chartHeight}
                  maxBinTotal={maxBinTotal}
                  perCardHeight={gear.heightMode === "perCard"}
                  maxBinCount={maxBinCount}
                  agentKeys={agentKeys}
                  colorFor={colorFor}
                  labelFor={labelFor}
                  onSegmentClick={openAgentDetail}
                  onOpenThread={thread.threadId ? () => navigate.toThread(thread.threadId!) : undefined}
                  onOpenCard={() => openSession(thread.session)}
                  fillWidth={gear.fillWidthFeed}
                  hugWidth={gear.hugWidth}
                  collapseEmpty={gear.collapseEmpty}
                  colWidthPx={gear.colWidthPx}
                  colGap={gear.colGap}
                  segGap={gear.segGap}
                  colRadius={gear.colRadius}
                  segRadius={gear.segRadius}
                  frameLiftColor={gear.frameLiftColor}
                />
              ))}
            </div>
            <div ref={sentinelRef} className="pt-4 text-center text-xs text-subtle-foreground">
              {filteredSorted.length === 0
                ? "No threads found"
                : visibleCount < filteredSorted.length || (phase === "ready" && limit < MAX_LIMIT && threads.length === limit)
                  ? "Loading…"
                  : `Showing all ${filteredSorted.length} threads`}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * Per-agent legend colour picker — all that's left of the former gear
 * popover (everything else moved to bb.settings.define, see this file's
 * module doc comment). agentColors can't be a declared setting: its keys
 * are agent ids discovered from session data, unknown ahead of time.
 */
function AgentColorsPopover({
  agentKeys,
  colorFor,
  labelFor,
  onAgentColorChange,
}: {
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
          aria-label="Agent colors"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 21a9 9 0 1 1 0-18c4.97 0 9 3.582 9 7.2 0 2.319-1.79 4.2-4 4.2h-1.877a1.6 1.6 0 0 0-1.123 2.74l.083.083a1.6 1.6 0 0 1-1.123 2.74z" />
            <circle cx="7.5" cy="10.5" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="11.5" cy="7" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="16" cy="9.5" r="1.2" fill="currentColor" stroke="none" />
          </svg>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70vh] w-64 space-y-1.5 overflow-y-auto p-3">
        <div className="text-xs font-medium text-muted-foreground">Agent colors</div>
        {agentKeys.length === 0 ? (
          <p className="text-xs text-subtle-foreground">No agent data yet.</p>
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {agentKeys.map((key) => (
              <div key={key} className="flex items-center gap-2">
                <span className="inline-block size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: colorFor(key) }} />
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{labelFor(key)}</span>
                <input
                  type="color"
                  value={colorFor(key)}
                  onChange={(e) => onAgentColorChange(key, e.target.value)}
                  className="h-6 w-8 shrink-0 cursor-pointer rounded-sm border border-border bg-transparent p-0"
                  aria-label={`${labelFor(key)} color`}
                />
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
