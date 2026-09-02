// Agent-detail sub-view — one agent's event-by-event timeline plus a
// left-hand copy of the header popover's session breakdown, with agent rows
// that switch the right panel instead of just listing totals. Ports
// prototype/agent-detail.html into real components/data; see that file for
// the approved visual reference.
//
// NOT a nav panel of its own. It's rendered by app.tsx's single
// "threads-timeline" nav panel (THREADS_TIMELINE_PANEL_PATH) whenever that
// panel's subPath is non-empty — an empty subPath renders
// ThreadsTimelinePage (the feed) instead. Both entry points (header popover
// row click, chart segment click) navigate to THREADS_TIMELINE_PANEL_PATH
// with subPath built by buildAgentDetailSubPath; the "Usage Analytics" back
// link below returns to subPath "".
//
// `agentTimeline` takes a Claude Code session id directly (not a BB
// threadId, which this page never has for a link that arrived from the
// threads-timeline chart) — see server.ts's contract doc comment. Its ready
// response already carries the session-wide totals/agent list alongside the
// one agent's own timeline, so this page makes exactly one rpc call per
// (session, agent) pair; the left panel (session breakdown + agent list) is
// fed from that same response instead of a second round trip.
import { useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { useBbNavigate, useRpc, useSettings, type PluginNavPanelProps, type PluginRpcResult } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DEFAULT_VIZ_SETTINGS,
  formatCost,
  formatPercent,
  formatTokenCount,
  parseGearSettings,
  type AgentTimelineEvent,
  type ChartSettings,
  type ThreadEntry,
  type ThreadsVizSettings,
} from "../src/core";
import { SessionChartCard } from "./thread-chart";

/**
 * Path of the one nav panel both pages of this plugin share — defined here
 * (rather than in ThreadsTimelinePage.tsx) so this file's own "back to feed"
 * link can use it without importing from ThreadsTimelinePage.tsx, which
 * itself imports from this file (buildAgentDetailSubPath); a reverse import
 * would make the two page modules circular.
 */
export const THREADS_TIMELINE_PANEL_PATH = "threads";

export interface AgentDetailLinkParams {
  agent: string;
  /** Claude Code session id — the one identifier both entry points (header popover, threads-timeline chart) can always supply. */
  session: string;
  /** ISO 8601 window bounds for the deep-link highlight, from a threads-timeline bin. */
  from?: string;
  to?: string;
}

// Single place that encodes/decodes the subPath — app.tsx's agent row, this
// page's own re-navigation (agent switch), and the threads-timeline chart all
// go through here. Ordered key/value PATH SEGMENTS, NOT a query string: BB
// routes subPath as a path remainder and percent-encodes it, so a `?a=b&c=d`
// query survives the round-trip as one opaque key and `session` is lost (the
// "no session id" dead end). Segments survive because `/` stays a separator;
// each value is encodeURIComponent'd so `:` in ISO timestamps is safe.
export function buildAgentDetailSubPath(params: AgentDetailLinkParams): string {
  const seg: string[] = ["agent", params.agent, "session", params.session];
  if (params.from) seg.push("from", params.from);
  if (params.to) seg.push("to", params.to);
  return seg.map(encodeURIComponent).join("/");
}

function parseAgentDetailSubPath(subPath: string): AgentDetailLinkParams {
  const parts = subPath
    .split("/")
    .filter((p) => p.length > 0)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
  const map = new Map<string, string>();
  for (let i = 0; i + 1 < parts.length; i += 2) map.set(parts[i], parts[i + 1]);
  return {
    // Empty session (missing key) is display-able, not a throw: a malformed or
    // stale link still renders the empty-session branch below instead of
    // firing rpc calls with a blank id.
    agent: map.get("agent") || "main",
    session: map.get("session") ?? "",
    from: map.get("from"),
    to: map.get("to"),
  };
}

type AgentTimelineResult = PluginRpcResult<(typeof rpcContract)["agentTimeline"]>;
type ReadyAgentTimeline = Extract<AgentTimelineResult, { status: "ready" }>;

type TimelineLoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: ReadyAgentTimeline };

/**
 * Same four phases as app.tsx's UsageDetails, duplicated rather than
 * imported: app.tsx is the top-level slot-assembly module (it imports THIS
 * file to register the nav panel), so a page importing back from it would
 * be a circular, upward dependency — against this repo's "dependencies run
 * strictly downward" rule. This file's map doesn't include a place to put a
 * shared module for the two to both import instead, so the four-row array
 * literal is kept in sync by hand; low risk, it mirrors sessionTotalsSchema
 * in server.ts and hasn't changed since the header control shipped.
 */
const TOKEN_PHASES: ReadonlyArray<{ key: "cacheRead" | "cacheWrite" | "input" | "output"; label: string }> = [
  { key: "cacheRead", label: "Cache read" },
  { key: "cacheWrite", label: "Cache write" },
  { key: "input", label: "Input" },
  { key: "output", label: "Output" },
];

interface Turn {
  headerIndex: number | null;
  itemIndices: number[];
}

/** A turn starts at a user message and runs up to (excluding) the next one; events before the first user message form a headerless leading turn. */
function computeTurns(events: readonly AgentTimelineEvent[]): { turns: Turn[]; indexToTurn: Map<number, number> } {
  const turns: Turn[] = [];
  let current: Turn = { headerIndex: null, itemIndices: [] };
  events.forEach((event, i) => {
    if (event.kind === "message" && event.role === "user") {
      if (current.headerIndex !== null || current.itemIndices.length > 0) turns.push(current);
      current = { headerIndex: i, itemIndices: [] };
    } else {
      current.itemIndices.push(i);
    }
  });
  turns.push(current);

  const indexToTurn = new Map<number, number>();
  turns.forEach((turn, t) => {
    if (turn.headerIndex !== null) indexToTurn.set(turn.headerIndex, t);
    turn.itemIndices.forEach((i) => indexToTurn.set(i, t));
  });
  return { turns, indexToTurn };
}

/**
 * Which event indices a `from`/`to` deep-link window should highlight.
 * Unlike the prototype (two independently mocked clocks, matched by
 * time-of-day only), `events[].ts` and the window bounds both come from
 * real ISO timestamps produced by the same backend, so this compares full
 * instants — no UTC-time-of-day workaround needed.
 */
function computeHighlightIndices(events: readonly AgentTimelineEvent[], fromIso?: string, toIso?: string): Set<number> | null {
  if (!fromIso && !toIso) return null;
  const fromMs = fromIso ? Date.parse(fromIso) : null;
  const toMs = toIso ? Date.parse(toIso) : null;
  if ((fromIso && Number.isNaN(fromMs)) || (toIso && Number.isNaN(toMs))) return null;
  const inWindow = (ms: number) => (fromMs === null || ms >= fromMs) && (toMs === null || ms <= toMs);

  const withinRange: number[] = [];
  events.forEach((event, i) => {
    const ms = Date.parse(event.ts);
    if (!Number.isNaN(ms) && inWindow(ms)) withinRange.push(i);
  });
  if (withinRange.length > 0) return new Set(withinRange);

  // Nothing falls exactly inside the window (e.g. this agent was idle
  // during that bin) — fall back to the single nearest event so the link
  // still lands somewhere visible instead of highlighting nothing.
  const targetMs = fromMs !== null && toMs !== null ? (fromMs + toMs) / 2 : (fromMs ?? toMs);
  if (targetMs === null) return null;
  let nearestIndex: number | null = null;
  let nearestDist = Infinity;
  events.forEach((event, i) => {
    const ms = Date.parse(event.ts);
    if (Number.isNaN(ms)) return;
    const dist = Math.abs(ms - targetMs);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestIndex = i;
    }
  });
  return nearestIndex === null ? null : new Set([nearestIndex]);
}

function formatAbsoluteTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatRelativeTime(ms: number): string {
  if (ms <= 0) return "+0s";
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `+${m}m${String(s).padStart(2, "0")}s` : `+${s}s`;
}

function displayAgentName(agent: { key: string; description: string | null; agentType: string | null }): string {
  if (agent.key === "main") return "Main agent";
  return agent.description ?? agent.agentType ?? "Subagent";
}

export function AgentTimelinePage({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();

  const linkParams = useMemo(() => parseAgentDetailSubPath(subPath), [subPath]);
  const session = linkParams.session || null;
  const activeAgentKey = linkParams.agent;

  function selectAgent(agentKey: string) {
    if (agentKey === activeAgentKey) return;
    navigate.toPluginPanel(THREADS_TIMELINE_PANEL_PATH, {
      // Deliberately drop from/to: a highlight window belongs to the agent
      // it was computed for, not to whatever agent is picked next.
      subPath: buildAgentDetailSubPath({ session: linkParams.session, agent: agentKey }),
      replace: true,
    });
  }

  // Segment click on THIS page's own session chart: unlike selectAgent above,
  // a chart segment always carries a bin's time window, and that window WAS
  // computed for the agentKey being navigated to — so it's kept, not dropped.
  // Re-navigating (even to the same agentKey) changes linkParams.from/to,
  // which re-triggers the highlight/scroll effect below on the already-loaded
  // timeline; switching agentKey additionally refetches it first.
  function selectSegment(agentKey: string, fromIso: string, toIso: string) {
    navigate.toPluginPanel(THREADS_TIMELINE_PANEL_PATH, {
      subPath: buildAgentDetailSubPath({ session: linkParams.session, agent: agentKey, from: fromIso, to: toIso }),
      replace: true,
    });
  }

  function backToFeed() {
    navigate.toPluginPanel(THREADS_TIMELINE_PANEL_PATH, { subPath: "" });
  }

  // --- Both panels: one rpc call per (session, agent), no "no-session"
  // status to handle anymore — the contract assumes an already-resolved
  // session (see module doc comment). ---
  const [timelineState, setTimelineState] = useState<TimelineLoadState>({ kind: "idle" });
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (!session) {
      setTimelineState({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setTimelineState({ kind: "loading" });
    rpc.call("agentTimeline", { session, agent: activeAgentKey }).then(
      (result) => {
        if (cancelled || !mountedRef.current) return;
        if (result.status === "ready") setTimelineState({ kind: "ready", data: result });
        else setTimelineState({ kind: "error", message: result.message });
      },
      (err: unknown) => {
        if (cancelled || !mountedRef.current) return;
        setTimelineState({
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to fetch the agent timeline.",
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, session, activeAgentKey]);

  // Session bar chart at the top — one horizontal token chart for the whole
  // session, workflow runs merged into single segments. Reuses the
  // threadsTimeline RPC's single-session slice (no new backend surface), so a
  // failure just hides the chart; the agent timeline below is the real content.
  const [sessionChart, setSessionChart] = useState<{ thread: ThreadEntry; agentLabels: Record<string, string> } | null>(null);
  // Chart geometry/behaviour — declared settings (bb.settings.define), read
  // live via useSettings(); this page never writes them (see
  // ThreadsTimelinePage.tsx's module doc comment for the full split).
  // `gear.unit` drives the bucket width below.
  const settingsState = useSettings();
  const gear = useMemo(() => parseGearSettings(settingsState.values), [settingsState.values]);
  // What's LEFT of the kv-persisted `threads` blob (agentColors + the
  // toolbar's sort/search/filter state, none of which this page edits) —
  // hydrated below, held so the session chart's agent colours match the
  // feed's and so a save can echo the rest back unchanged.
  const [threadsSettings, setThreadsSettings] = useState<ThreadsVizSettings>(DEFAULT_VIZ_SETTINGS.threads);
  const chartSettings: ChartSettings = useMemo(
    () => ({ ...gear, agentColors: threadsSettings.agentColors }),
    [gear, threadsSettings.agentColors],
  );
  // Merge markers are resolved ONLY by the agentTimeline RPC (a live `gh pr
  // view` per PR — see memory/decisions/merge-marker-session-page-only.md),
  // never by threadsTimeline itself — sessionChart's own thread.events never
  // carries them. Spliced in here, client-side, so this page's chart is the
  // only place they ever appear.
  const mergeEvents = timelineState.kind === "ready" ? timelineState.data.mergeEvents : [];
  const sessionChartThread = useMemo(() => {
    if (!sessionChart) return null;
    if (mergeEvents.length === 0) return sessionChart.thread;
    return { ...sessionChart.thread, events: [...sessionChart.thread.events, ...mergeEvents].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)) };
  }, [sessionChart, mergeEvents]);
  useEffect(() => {
    if (!session) {
      setSessionChart(null);
      return;
    }
    let cancelled = false;
    rpc.call("threadsTimeline", { limit: 1, unit: gear.unit, session, groupWorkflows: true }).then(
      (result) => {
        if (cancelled || !mountedRef.current) return;
        setSessionChart(
          result.status === "ready" && result.threads.length > 0
            ? { thread: result.threads[0], agentLabels: result.agentLabels }
            : null,
        );
      },
      () => {
        if (!cancelled && mountedRef.current) setSessionChart(null);
      },
    );
    return () => {
      cancelled = true;
    };
    // Agent switch keeps the same session chart — depends on `session` and
    // the bucket width, which also refetches if the gear's saved time-unit
    // setting changes.
  }, [rpc, session, gear.unit]);

  // --- Timeline display controls: NOT reset on agent change (they're
  // standing preferences, persisted below) — only `expanded`/`collapsedTurns`
  // (per-timeline UI state) reset in the effect further down.
  const [showHooks, setShowHooks] = useState(DEFAULT_VIZ_SETTINGS.agentDetail.showHooks);
  const [relativeTime, setRelativeTime] = useState(DEFAULT_VIZ_SETTINGS.agentDetail.relativeTime);
  const [groupedByTurn, setGroupedByTurn] = useState(DEFAULT_VIZ_SETTINGS.agentDetail.groupedByTurn);

  // --- Viz-settings persistence (bb.storage.kv via loadVizSettings/
  // saveVizSettings — see memory/decisions/token-usage-viz-settings-persist-kv.md
  // and memory/decisions/token-usage-gear-to-native-settings.md). This page
  // owns and edits only the `agentDetail` section (showHooks/relativeTime/
  // groupedByTurn); the sibling `threads` section (now just agentColors +
  // toolbar sort/search/filter state, geometry having moved to
  // bb.settings.define) belongs to ThreadsTimelinePage.tsx. This page still
  // keeps its own copy (threadsSettings, declared above) for two reasons:
  // the session chart above needs the SAME agent colours as the feed, and a
  // save always sends the FULL VizSettings object (the RPC schema requires
  // both sections) — so whatever `threads` this page last loaded is echoed
  // back unchanged on every save, since this page never edits it.
  const [vizHydrated, setVizHydrated] = useState(false);
  const skipNextSaveRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    rpc.call("loadVizSettings", {}).then(
      (settings) => {
        if (cancelled || !mountedRef.current) return;
        skipNextSaveRef.current = true;
        setThreadsSettings(settings.threads);
        setShowHooks(settings.agentDetail.showHooks);
        setRelativeTime(settings.agentDetail.relativeTime);
        setGroupedByTurn(settings.agentDetail.groupedByTurn);
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
          threads: threadsSettings,
          agentDetail: { showHooks, relativeTime, groupedByTurn },
        })
        .catch(() => {
          // Best-effort persistence — a failed save just means this
          // preference doesn't survive to the next session; nothing in this
          // page depends on the write succeeding.
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [vizHydrated, showHooks, relativeTime, groupedByTurn, threadsSettings, rpc]);

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [collapsedTurns, setCollapsedTurns] = useState<Set<number>>(new Set());
  // "Full Input/Output" expansion — same logic as expanded/collapsedTurns
  // above: resets on agent change rather than surviving the switch.
  const [showFullContent, setShowFullContent] = useState(false);
  useEffect(() => {
    setExpanded(new Set());
    setCollapsedTurns(new Set());
    setShowFullContent(false);
  }, [activeAgentKey]);

  // --- Deep-link highlight: recomputed whenever the timeline (re)loads or the link's window changes. ---
  const containerRef = useRef<HTMLDivElement>(null);
  const [highlighted, setHighlighted] = useState<Set<number> | null>(null);
  useEffect(() => {
    if (timelineState.kind !== "ready") return;
    const next = computeHighlightIndices(timelineState.data.events, linkParams.from, linkParams.to);
    setHighlighted(next);
    if (!next || next.size === 0) return;

    const firstIndex = Math.min(...next);
    if (groupedByTurn) {
      const { indexToTurn } = computeTurns(timelineState.data.events);
      const turnIndex = indexToTurn.get(firstIndex);
      if (turnIndex !== undefined) {
        setCollapsedTurns((prev) => {
          if (!prev.has(turnIndex)) return prev;
          const next2 = new Set(prev);
          next2.delete(turnIndex);
          return next2;
        });
      }
    }

    const raf = requestAnimationFrame(() => {
      const el = containerRef.current?.querySelector(`[data-ev-index="${firstIndex}"]`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    const timer = setTimeout(() => setHighlighted(null), 4000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
    // groupedByTurn intentionally excluded: this effect only needs to run
    // once per fresh deep link (new data or a new from/to window), not on
    // every later toggle of grouping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineState, linkParams.from, linkParams.to]);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="shrink-0 border-b border-border px-4 py-2 md:px-5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={backToFeed}
        >
          <span aria-hidden="true">←</span> Usage Analytics
        </Button>
      </div>
      {sessionChart && sessionChartThread && (
        <div className="shrink-0 px-4 pt-3 md:px-5">
          <div className="mb-1 text-xs font-medium text-muted-foreground">Session chart</div>
          <SessionChartCard
            thread={sessionChartThread}
            agentLabels={sessionChart.agentLabels}
            settings={chartSettings}
            fillWidth={chartSettings.fillWidthSession}
            onSelectAgent={selectSegment}
            activeAgentKey={activeAgentKey}
          />
        </div>
      )}
      <div className="grid grow grid-cols-1 gap-4 p-4 md:p-5 lg:grid-cols-[20rem_1fr] lg:items-start">
        <LeftPanel
        session={session}
        timelineState={timelineState}
        activeAgentKey={activeAgentKey}
        onSelectAgent={selectAgent}
      />
      <RightPanel
        containerRef={containerRef}
        session={session}
        linkParams={linkParams}
        timelineState={timelineState}
        showHooks={showHooks}
        onToggleShowHooks={() => setShowHooks((v) => !v)}
        relativeTime={relativeTime}
        onToggleRelativeTime={() => setRelativeTime((v) => !v)}
        groupedByTurn={groupedByTurn}
        onToggleGroupedByTurn={() => setGroupedByTurn((v) => !v)}
        expanded={expanded}
        onToggleExpanded={(i) =>
          setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(i)) next.delete(i);
            else next.add(i);
            return next;
          })
        }
        collapsedTurns={collapsedTurns}
        onToggleTurnCollapsed={(t) =>
          setCollapsedTurns((prev) => {
            const next = new Set(prev);
            if (next.has(t)) next.delete(t);
            else next.add(t);
            return next;
          })
        }
        onSetAllTurnsCollapsed={(collapsed) => {
          if (timelineState.kind !== "ready") return;
          const { turns } = computeTurns(timelineState.data.events);
          setCollapsedTurns(() => {
            const next = new Set<number>();
            turns.forEach((turn, t) => {
              if (turn.headerIndex === null) return;
              if (collapsed) next.add(t);
            });
            return next;
          });
        }}
        highlighted={highlighted}
        onClearHighlight={() => setHighlighted(null)}
        showFullContent={showFullContent}
        onToggleShowFullContent={() => setShowFullContent((v) => !v)}
      />
      </div>
    </div>
  );
}

function LeftPanel({
  session,
  timelineState,
  activeAgentKey,
  onSelectAgent,
}: {
  session: string | null;
  timelineState: TimelineLoadState;
  activeAgentKey: string;
  onSelectAgent: (agentKey: string) => void;
}) {
  if (!session) {
    return (
      <div className="space-y-2 rounded-lg border border-border bg-popover p-4 text-xs text-muted-foreground lg:sticky lg:top-4">
        <p className="font-medium text-foreground">No session id Claude Code</p>
        <p>
          This link carries no session parameter — the token breakdown is
          unavailable. Open the detail view by clicking an agent row in the
          thread's token counter, or a chart segment in Usage Analytics.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-popover p-4 lg:sticky lg:top-4">
      {(timelineState.kind === "loading" || timelineState.kind === "idle") && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
      {timelineState.kind === "error" && <p className="text-sm text-destructive">{timelineState.message}</p>}
      {timelineState.kind === "ready" && (
        <>
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium text-foreground">Total tokens</span>
            <span className="text-sm font-semibold tabular-nums text-foreground">
              {formatTokenCount(timelineState.data.totals.total)}
            </span>
          </div>

          <dl className="space-y-1">
            {TOKEN_PHASES.map(({ key, label }) => {
              const value = timelineState.data.totals[key];
              return (
                <div key={key} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <dt>{label}</dt>
                  <dd className="tabular-nums">
                    {formatTokenCount(value)}{" "}
                    <span className="text-subtle-foreground">({formatPercent(value, timelineState.data.totals.total)})</span>{" "}
                    · {formatCost(timelineState.data.totals.costs[key])}
                  </dd>
                </div>
              );
            })}
            <div className="flex items-center justify-between gap-2 pl-3 text-xs text-subtle-foreground">
              <dt>incl. thinking</dt>
              <dd className="tabular-nums">
                {formatTokenCount(timelineState.data.totals.thinking)}{" "}
                <span>({formatPercent(timelineState.data.totals.thinking, timelineState.data.totals.output)})</span>{" "}
                · {formatCost(timelineState.data.totals.costs.thinking)}
              </dd>
            </div>
          </dl>

          <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
            <span>Cost</span>
            <span className="font-medium tabular-nums text-foreground">{formatCost(timelineState.data.totals.cost)}</span>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Responses</span>
            <span className="font-medium tabular-nums text-foreground">{timelineState.data.totals.messages}</span>
          </div>

          {timelineState.data.agents.length > 0 && (
            <div className="space-y-1 border-t border-border pt-2">
              <span className="text-xs font-medium text-muted-foreground">Agents</span>
              <ul className="space-y-1">
                {timelineState.data.agents.map((agent) => {
                  const active = agent.key === activeAgentKey;
                  return (
                    <li key={agent.key}>
                      <button
                        type="button"
                        onClick={() => onSelectAgent(agent.key)}
                        aria-pressed={active}
                        className={cn(
                          "flex w-full items-start justify-between gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-state-hover",
                          active && "bg-state-active",
                        )}
                      >
                        <span className="min-w-0">
                          <span className={cn("block truncate", active ? "text-foreground" : "text-foreground/90")} title={agent.name}>
                            {agent.name}
                          </span>
                          {agent.caption && <span className="block truncate text-subtle-foreground">{agent.caption}</span>}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {formatTokenCount(agent.total)} · {formatCost(agent.cost)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Full (not the 300-char preview) text of the agent's request or response —
 * agent.requestFull/responseFull from agentTimeline, not events[].text.
 * No inner scroll — the block expands to the text's full height (up to
 * FULL_TEXT_MAX, 20000 chars in tools/agent_timeline.py), the page around it
 * scrolls on its own.
 */
function FullContentBlock({ label, text, truncated }: { label: string; text: string | null; truncated: boolean }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="font-medium text-foreground">{label}</span>
        {truncated && <span className="text-subtle-foreground">not everything is shown</span>}
      </div>
      {text ? (
        <pre className="whitespace-pre-wrap break-words rounded bg-card p-2 font-mono text-muted-foreground">{text}</pre>
      ) : (
        <p className="text-subtle-foreground">No text.</p>
      )}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-md border border-border bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">{children}</span>
  );
}

function ToggleButton({ pressed, onClick, label, on, off }: { pressed: boolean; onClick: () => void; label: string; on: string; off: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={pressed}
      onClick={onClick}
      className="h-7 border border-input px-2.5 text-xs font-medium text-muted-foreground"
    >
      {label}: <span className="ml-1">{pressed ? on : off}</span>
    </Button>
  );
}

interface RightPanelProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  session: string | null;
  linkParams: AgentDetailLinkParams;
  timelineState: TimelineLoadState;
  showHooks: boolean;
  onToggleShowHooks: () => void;
  relativeTime: boolean;
  onToggleRelativeTime: () => void;
  groupedByTurn: boolean;
  onToggleGroupedByTurn: () => void;
  expanded: Set<number>;
  onToggleExpanded: (i: number) => void;
  collapsedTurns: Set<number>;
  onToggleTurnCollapsed: (t: number) => void;
  onSetAllTurnsCollapsed: (collapsed: boolean) => void;
  highlighted: Set<number> | null;
  onClearHighlight: () => void;
  showFullContent: boolean;
  onToggleShowFullContent: () => void;
}

function RightPanel(props: RightPanelProps) {
  const { session, linkParams, timelineState } = props;

  if (!session) {
    return (
      <div className="min-w-0 space-y-3 text-sm text-muted-foreground">
        <p>
          Without a session parameter, this page can't request the timeline.
          Link parameters: agent <span className="font-mono text-foreground">{linkParams.agent}</span>
          {linkParams.from && linkParams.to && (
            <>
              , window {formatAbsoluteTime(linkParams.from)}–{formatAbsoluteTime(linkParams.to)}
            </>
          )}
          .
        </p>
      </div>
    );
  }

  if (timelineState.kind === "loading" || timelineState.kind === "idle") {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (timelineState.kind === "error") {
    return <p className="text-sm text-destructive">{timelineState.message}</p>;
  }

  return <ReadyRightPanel {...props} agent={timelineState.data.agent} events={timelineState.data.events} />;
}

function ReadyRightPanel(
  props: RightPanelProps & { agent: ReadyAgentTimeline["agent"]; events: AgentTimelineEvent[] },
) {
  const {
    containerRef,
    agent,
    events,
    showHooks,
    onToggleShowHooks,
    relativeTime,
    onToggleRelativeTime,
    groupedByTurn,
    onToggleGroupedByTurn,
    expanded,
    onToggleExpanded,
    collapsedTurns,
    onToggleTurnCollapsed,
    onSetAllTurnsCollapsed,
    highlighted,
    onClearHighlight,
    showFullContent,
    onToggleShowFullContent,
  } = props;

  const { turns, indexToTurn } = useMemo(() => computeTurns(events), [events]);
  const firstTs = events.length > 0 ? Date.parse(events[0].ts) : NaN;

  function formatTime(ts: string): string {
    if (!relativeTime) return formatAbsoluteTime(ts);
    const ms = Date.parse(ts);
    if (Number.isNaN(ms) || Number.isNaN(firstTs)) return formatAbsoluteTime(ts);
    return formatRelativeTime(ms - firstTs);
  }

  // The prototype used a `text-info`/`bg-info` blue accent for links and
  // this highlight; grepping every plugin's components/ + app.tsx in this
  // repo turns up no "info" token anywhere real (only in the prototype's
  // own mock prototype/bb-theme.js), so it isn't confirmed to exist in the
  // actual BB theme. Falls back to `primary`, the one accent token this
  // plugin already uses elsewhere — see NOTES for the open question back
  // to the design-system owner about whether a real "info" token exists.
  function highlightCls(i: number): string {
    return highlighted?.has(i) ? "!bg-primary/10 !border-l-2 !border-primary" : "";
  }

  // Two right-aligned columns (tokens, $) appended to every event row —
  // filled only for assistant-message rows that carry usage (see
  // messageEventSchema in src/core/agent-timeline.ts); blank cells on
  // tool/hook/user rows keep the columns aligned without implying a cost
  // that wasn't tracked for that row.
  function costCells(tokens: number | undefined, cost: number | undefined): React.ReactNode {
    return (
      <>
        <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
          {tokens !== undefined ? formatTokenCount(tokens) : ""}
        </span>
        <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
          {cost !== undefined ? formatCost(cost) : ""}
        </span>
      </>
    );
  }

  /** Sum of `cost` across a turn's own assistant messages — shown in that turn's header row when grouped. */
  function turnCost(turn: Turn): number {
    return turn.itemIndices.reduce((sum, idx) => {
      const e = events[idx];
      return e.kind === "message" && e.role === "assistant" && e.cost !== undefined ? sum + e.cost : sum;
    }, 0);
  }

  function eventRow(i: number): React.ReactNode {
    const event = events[i];
    if (event.kind === "hook") {
      return (
        <div
          key={i}
          data-ev-index={i}
          className={cn("flex items-center gap-3 border-l-2 border-primary/40 bg-primary/[0.04] px-3 py-1", highlightCls(i))}
        >
          <span className="w-[74px] shrink-0 font-mono text-xs tabular-nums text-subtle-foreground">{formatTime(event.ts)}</span>
          <span className="w-14 shrink-0 text-xs font-medium text-muted-foreground">hook</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {event.hookName ?? "?"} <span className="text-subtle-foreground">· {event.hookEvent ?? "?"}</span>
          </span>
          {costCells(undefined, undefined)}
        </div>
      );
    }
    if (event.kind === "tool") {
      return (
        <div key={i} data-ev-index={i} className={cn("flex items-center gap-3 px-3 py-1", highlightCls(i))}>
          <span className="w-[74px] shrink-0 font-mono text-xs tabular-nums text-subtle-foreground">{formatTime(event.ts)}</span>
          <span className="w-14 shrink-0 text-xs font-medium text-muted-foreground">{event.name}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{event.target ?? ""}</span>
          {costCells(undefined, undefined)}
        </div>
      );
    }
    return messageRow(i, event, false);
  }

  function messageRow(i: number, event: Extract<AgentTimelineEvent, { kind: "message" }>, isHeader: boolean): React.ReactNode {
    const label = event.role === "assistant" ? "assistant" : "user";
    const isExpanded = expanded.has(i);
    const turnIdx = indexToTurn.get(i);
    const tools =
      turnIdx !== undefined
        ? turns[turnIdx].itemIndices.map((idx) => events[idx]).filter((e): e is Extract<AgentTimelineEvent, { kind: "tool" }> => e.kind === "tool")
        : [];
    const turnCollapsed = isHeader && turnIdx !== undefined && collapsedTurns.has(turnIdx);
    const itemCount = isHeader && turnIdx !== undefined ? turns[turnIdx].itemIndices.length : 0;
    // Header rows (the turn's own leading user message) show the turn's
    // aggregate cost instead of this one message's own tokens/cost — a user
    // message never carries usage itself (see messageEventSchema).
    const headerTurnCost = isHeader && turnIdx !== undefined ? turnCost(turns[turnIdx]) : undefined;

    return (
      <div key={i} className={isHeader ? "mt-0.5 border-t border-border pt-1.5" : undefined}>
        <div
          data-ev-index={i}
          className={cn("flex cursor-pointer items-center gap-3 px-3 py-1 hover:bg-state-hover", highlightCls(i))}
          onClick={() => onToggleExpanded(i)}
        >
          {isHeader && turnIdx !== undefined && (
            <span
              className="w-3 shrink-0 cursor-pointer text-xs text-subtle-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onToggleTurnCollapsed(turnIdx);
              }}
            >
              {turnCollapsed ? "▸" : "▾"}
            </span>
          )}
          <span className="w-[74px] shrink-0 font-mono text-xs tabular-nums text-subtle-foreground">{formatTime(event.ts)}</span>
          <span className="w-3 shrink-0 text-xs text-subtle-foreground">{isExpanded ? "▾" : "▸"}</span>
          <span className="w-24 shrink-0 truncate text-xs font-medium text-foreground">{label}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{event.text}</span>
          {isHeader && <span className="shrink-0 text-xs text-subtle-foreground">{itemCount}</span>}
          {costCells(isHeader ? undefined : event.tokens, isHeader ? headerTurnCost : event.cost)}
        </div>
        {isExpanded && (
          <div className="space-y-2 px-3 pb-1.5 pl-[104px]">
            <div className="space-y-1">
              {event.fullTextTruncated && <p className="text-xs text-subtle-foreground">not everything is shown</p>}
              <pre className="whitespace-pre-wrap break-words rounded bg-card p-2 font-mono text-xs text-muted-foreground">{event.fullText}</pre>
            </div>
            {tools.length === 0 ? (
              <div className="text-xs text-subtle-foreground">No tools were used</div>
            ) : (
              <div className="space-y-0.5">
                {tools.map((tool, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs">
                    <span className="w-14 shrink-0 text-muted-foreground">{tool.name}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-subtle-foreground">{tool.target ?? ""}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  let visibleCount = 0;
  let rows: React.ReactNode[] = [];
  if (!groupedByTurn) {
    events.forEach((event, i) => {
      if (event.kind === "hook" && !showHooks) return;
      visibleCount++;
      rows.push(eventRow(i));
    });
  } else {
    turns.forEach((turn, t) => {
      if (turn.headerIndex !== null) {
        const headerEvent = events[turn.headerIndex];
        if (headerEvent.kind === "message") {
          visibleCount++;
          rows.push(messageRow(turn.headerIndex, headerEvent, true));
        }
      }
      const collapsed = turn.headerIndex !== null && collapsedTurns.has(t);
      if (collapsed) return;
      const visibleItems = turn.itemIndices.filter((i) => !(events[i].kind === "hook" && !showHooks));
      if (visibleItems.length === 0) return;
      visibleCount += visibleItems.length;
      rows.push(
        <div key={`turn-${t}`} className={turn.headerIndex !== null ? "ml-5 border-l border-border pl-2" : undefined}>
          {visibleItems.map((i) => eventRow(i))}
        </div>,
      );
    });
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="border-b border-border pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate font-mono text-sm font-semibold text-foreground">{agent.key}</h1>
          {agent.agentType && <Badge>{agent.agentType}</Badge>}
          {agent.model && <Badge>{agent.model}</Badge>}
          {agent.spawnDepth !== null && <Badge>{`depth ${agent.spawnDepth}`}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">{displayAgentName(agent)}</p>
        {agent.promptExcerpt && (
          <div className="mt-3 border-l-2 border-border pl-2">
            <div className="mb-1 text-xs font-medium text-muted-foreground">Prompt</div>
            <p className="font-mono text-xs text-muted-foreground">{agent.promptExcerpt}</p>
          </div>
        )}
        {(agent.requestFull || agent.responseFull) && (
          <div className="mt-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 border border-input px-2 text-xs font-medium text-muted-foreground"
              aria-expanded={showFullContent}
              onClick={onToggleShowFullContent}
            >
              {showFullContent ? "Hide content" : "Full content"}
            </Button>
            {showFullContent && (
              <div className="mt-2 space-y-2 rounded-md border border-border bg-popover p-2 text-xs">
                <FullContentBlock label="Input" text={agent.requestFull} truncated={agent.requestFullTruncated} />
                <FullContentBlock label="Output" text={agent.responseFull} truncated={agent.responseFullTruncated} />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
        <ToggleButton pressed={showHooks} onClick={onToggleShowHooks} label="Hooks" on="on" off="off" />
        <ToggleButton pressed={relativeTime} onClick={onToggleRelativeTime} label="Time" on="relative" off="absolute" />
        <ToggleButton pressed={groupedByTurn} onClick={onToggleGroupedByTurn} label="Grouping" on="by turn" off="flat" />
        {groupedByTurn && (
          <span className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" className="h-7 border border-input px-2.5 text-xs font-medium text-muted-foreground" onClick={() => onSetAllTurnsCollapsed(true)}>
              Collapse all
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-7 border border-input px-2.5 text-xs font-medium text-muted-foreground" onClick={() => onSetAllTurnsCollapsed(false)}>
              Expand all
            </Button>
          </span>
        )}
      </div>

      <div className="rounded-lg border border-border">
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <span className="text-xs font-medium text-muted-foreground">Session timeline</span>
          <span className="text-xs text-subtle-foreground">{visibleCount} events</span>
        </div>
        <div
          ref={containerRef}
          className="divide-y divide-border"
          onClick={() => {
            if (highlighted) onClearHighlight();
          }}
        >
          {rows}
        </div>
      </div>
    </div>
  );
}
