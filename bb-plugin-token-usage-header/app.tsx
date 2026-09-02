// bb-plugin-token-usage-header — frontend entry.
//
// One thread-header control: a compact button showing the session's total
// token spend, with a popover for the full breakdown. Mounted once per
// visible thread (twice in a split view) — all state lives in the
// component, never at module scope.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRpc,
  useSettings,
  type PluginNavPanelProps,
  type PluginRpcResult,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  DEFAULT_VIZ_SETTINGS,
  formatCost,
  formatPercent,
  formatTokenCount,
  parseGearSettings,
  type ChartSettings,
  type ThreadEntry,
} from "./src/core";
import { AgentTimelinePage, buildAgentDetailSubPath, THREADS_TIMELINE_PANEL_PATH } from "./pages/AgentTimelinePage";
import { ThreadsTimelinePage } from "./pages/ThreadsTimelinePage";
import { SessionChartCard } from "./pages/thread-chart";

type SessionTokenUsage = PluginRpcResult<(typeof rpcContract)["sessionTokenUsage"]>;
type ReadyUsage = Extract<SessionTokenUsage, { status: "ready" }>;

type LoadState =
  | { kind: "loading" }
  | { kind: "no-session" }
  | { kind: "error"; message: string }
  | { kind: "ready"; usage: ReadyUsage };

/**
 * The four phases of one model call, in display order: the three parts of
 * input fed in together (what was already cached and re-read, what was
 * newly cached, what was neither), then the generated output. `thinking`
 * isn't a phase of its own — it's already counted inside `output_tokens`,
 * so it's rendered as a nested line under the output row instead of
 * appearing here (see the nested row in UsageDetails below).
 */
const TOKEN_PHASES: ReadonlyArray<{
  key: "cacheRead" | "cacheWrite" | "input" | "output";
  label: string;
}> = [
  { key: "cacheRead", label: "Cache read" },
  { key: "cacheWrite", label: "Cache write" },
  { key: "input", label: "Input" },
  { key: "output", label: "Output" },
];

function TokenUsageHeaderAction({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [open, setOpen] = useState(false);

  // Guards two ways a response can arrive after it stops mattering: a
  // slower earlier request (mount) resolving after a faster later one
  // (popover open) — only the response matching the current generation is
  // applied — and any response arriving after unmount, which `mountedRef`
  // catches regardless of generation.
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Chart geometry/behaviour — declared settings (bb.settings.define, Tools
  // → Usage Analytics), read live via useSettings() so this popover's own
  // session chart renders identically configured to the feed's, instead of
  // its own hardcoded defaults — see ThreadsTimelinePage.tsx's module doc
  // comment for the full split. agentColors (dynamic, can't be a declared
  // setting) is still loaded from bb.storage.kv separately, below.
  const settingsState = useSettings();
  const gear = useMemo(() => parseGearSettings(settingsState.values), [settingsState.values]);
  const [agentColors, setAgentColors] = useState<Record<string, string>>(DEFAULT_VIZ_SETTINGS.threads.agentColors);
  useEffect(() => {
    rpc.call("loadVizSettings", {}).then(
      (settings) => {
        if (!mountedRef.current) return;
        setAgentColors(settings.threads.agentColors);
      },
      () => {
        // Best-effort — keep the schema's own default (no overrides) already in state.
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc]);
  const chartSettings: ChartSettings = useMemo(() => ({ ...gear, agentColors }), [gear, agentColors]);

  function load() {
    const requestId = ++requestIdRef.current;
    setState({ kind: "loading" });
    rpc.call("sessionTokenUsage", { threadId }).then(
      (result) => {
        if (!mountedRef.current || requestIdRef.current !== requestId) return;
        if (result.status === "ready") setState({ kind: "ready", usage: result });
        else if (result.status === "no-session") setState({ kind: "no-session" });
        else setState({ kind: "error", message: result.message });
      },
      (err: unknown) => {
        if (!mountedRef.current || requestIdRef.current !== requestId) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Failed to fetch token data.",
        });
      },
    );
  }

  // Fetch once per mounted thread; re-fetching happens on popover open, not
  // on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [threadId]);

  // Session bar chart at the top of the popover — same chart frame as the
  // session page (SessionChartCard), fed by the same single-session slice of
  // threadsTimeline. A failure just hides the chart; the totals/agent list
  // below is the load-bearing content.
  const [sessionChart, setSessionChart] = useState<{ thread: ThreadEntry; agentLabels: Record<string, string> } | null>(null);
  const chartSessionId = state.kind === "ready" ? state.usage.sessionId : null;
  useEffect(() => {
    if (!chartSessionId) {
      setSessionChart(null);
      return;
    }
    let cancelled = false;
    rpc.call("threadsTimeline", { limit: 1, unit: gear.unit, session: chartSessionId, groupWorkflows: true }).then(
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc, chartSessionId, gear.unit]);

  // Clicking an agent row (below) navigates into the "threads-timeline"
  // panel's agent-detail sub-view, with the session id resolved
  // server-side for THIS thread (sessionTokenUsage's ready `sessionId`) —
  // `agentTimeline` takes a session directly now, not a BB threadId (see
  // pages/AgentTimelinePage.tsx's module doc comment).
  function openAgentDetails(agentKey: string, sessionId: string) {
    navigate.toPluginPanel(THREADS_TIMELINE_PANEL_PATH, {
      subPath: buildAgentDetailSubPath({ session: sessionId, agent: agentKey }),
    });
  }

  const isError = state.kind === "error";
  const buttonText =
    state.kind === "ready"
      ? `${formatTokenCount(state.usage.totals.total)} · ${formatCost(state.usage.totals.cost)}`
      : state.kind === "no-session"
        ? "–"
        : state.kind === "loading"
          ? "…"
          : "";
  const ariaLabel =
    state.kind === "ready"
      ? `Token usage Claude Code: ${formatTokenCount(state.usage.totals.total)}, ${formatCost(state.usage.totals.cost)}`
      : state.kind === "no-session"
        ? "Claude Code token usage: session not started yet"
        : state.kind === "loading"
          ? "Claude Code token usage: loading"
          : `Token usage Claude Code: error — ${state.message}`;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) load();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={ariaLabel}
          className="h-7 gap-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground data-[state=open]:text-foreground"
        >
          <Icon name={isError ? "AlertCircle" : "ChartColumn"} className={cn("size-3.5", isError && "text-destructive")} aria-hidden="true" />
          {/* The SDK's contract for isCompactViewport: "Collapse to an
              icon-sized control when it is true — the row is short." The
              number stays available via aria-label. */}
          {buttonText && !isCompactViewport && <span className={cn(isError && "text-destructive")}>{buttonText}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[70vh] w-80 space-y-3 overflow-y-auto">
        {state.kind === "loading" && <p className="text-sm text-muted-foreground">Loading…</p>}
        {state.kind === "no-session" && (
          <p className="text-sm text-muted-foreground">
            Session hasn't started yet — the counter appears after the first response.
          </p>
        )}
        {state.kind === "error" && <p className="text-sm text-destructive">{state.message}</p>}
        {state.kind === "ready" && (
          <UsageDetails
            usage={state.usage}
            sessionChart={sessionChart}
            chartSettings={chartSettings}
            onAgentDetails={openAgentDetails}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function UsageDetails({
  usage,
  sessionChart,
  chartSettings,
  onAgentDetails,
}: {
  usage: ReadyUsage;
  /** Session bar chart to render above the totals — null while it's loading or unavailable (chart is a bonus, not load-bearing). */
  sessionChart: { thread: ThreadEntry; agentLabels: Record<string, string> } | null;
  /** Same geometry/colour settings as the "Usage Analytics" feed's gear popover — keeps this chart visually identical to the feed's and the session page's. */
  chartSettings: ChartSettings;
  /** Navigates to the agent-detail sub-view for one agent row; omitted renders the row inert (no hover/click). */
  onAgentDetails?: (agentKey: string, sessionId: string) => void;
}) {
  const { totals, agents } = usage;
  return (
    <div className="space-y-3">
      {sessionChart && (
        <SessionChartCard
          thread={sessionChart.thread}
          agentLabels={sessionChart.agentLabels}
          settings={chartSettings}
          fillWidth={chartSettings.fillWidthPopover}
        />
      )}

      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-foreground">Total tokens</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">{formatTokenCount(totals.total)}</span>
      </div>

      <dl className="space-y-1">
        {TOKEN_PHASES.map(({ key, label }) => {
          const value = totals[key];
          return (
            <div key={key} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <dt>{label}</dt>
              <dd className="tabular-nums">
                {formatTokenCount(value)}{" "}
                <span className="text-muted-foreground/70">({formatPercent(value, totals.total)})</span>{" "}
                · {formatCost(totals.costs[key])}
              </dd>
            </div>
          );
        })}
        {/* Thinking is part of the output, not a fifth phase — nested under
            the output row above, its share is of `totals.output` (the
            share of `totals.total` would always read "0%"). */}
        <div className="flex items-center justify-between gap-2 pl-3 text-xs text-muted-foreground/70">
          <dt>incl. thinking</dt>
          <dd className="tabular-nums">
            {formatTokenCount(totals.thinking)}{" "}
            <span className="text-muted-foreground/50">({formatPercent(totals.thinking, totals.output)})</span>{" "}
            · {formatCost(totals.costs.thinking)}
          </dd>
        </div>
      </dl>

      <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
        <span>Cost</span>
        <span className="font-medium tabular-nums text-foreground">{formatCost(totals.cost)}</span>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Responses</span>
        <span className="font-medium tabular-nums text-foreground">{totals.messages}</span>
      </div>

      {agents.length > 0 && (
        <div className="space-y-1 border-t border-border pt-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-muted-foreground">Agents</span>
            {usage.truncated && (
              <span className="text-xs text-muted-foreground/70">not all shown</span>
            )}
          </div>
          <ul className="space-y-0.5">
            {/* Name and caption aren't recomputed here — they already arrive
                ready from the server (formatBucketDisplay), see
                memory/decisions/token-usage-one-caption-source.md.
                Whole row is the click target (no separate "Details" button)
                — same row treatment as the "Agents" list in
                pages/AgentTimelinePage.tsx's LeftPanel. */}
            {agents.map((agent) => (
              <li key={agent.key}>
                <button
                  type="button"
                  disabled={!onAgentDetails}
                  onClick={() => onAgentDetails?.(agent.key, usage.sessionId)}
                  className={cn(
                    "flex w-full items-start justify-between gap-2 rounded-md px-2 py-1 text-left text-xs",
                    onAgentDetails && "cursor-pointer hover:bg-state-hover",
                  )}
                >
                  <div className="min-w-0">
                    <div className="truncate text-foreground" title={agent.name}>
                      {agent.name}
                    </div>
                    {agent.caption && <div className="truncate text-muted-foreground/70">{agent.caption}</div>}
                  </div>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatTokenCount(agent.total)} · {formatCost(agent.cost)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The single "Usage Analytics" nav panel's own router: an empty `subPath` is
 * the feed (ThreadsTimelinePage), anything else is the agent-detail
 * sub-view (AgentTimelinePage) — see AgentTimelinePage.tsx's module doc
 * comment. "Agent breakdown" used to be a second, separately registered
 * nav panel (`agent-detail`); it was a dead left-menu entry (opened
 * directly, with no session, it only ever showed "No session id") and is
 * folded into this one panel instead, reachable only by navigating here
 * with a subPath — never from the left menu directly.
 */
function ThreadsTimelinePanel({ subPath }: PluginNavPanelProps) {
  if (subPath === "") return <ThreadsTimelinePage subPath={subPath} />;
  return <AgentTimelinePage subPath={subPath} />;
}

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "token-usage-header",
    title: "Token usage",
    component: TokenUsageHeaderAction,
  });

  app.slots.navPanel({
    id: "threads-timeline",
    title: "Usage Analytics",
    icon: "ChartColumn",
    path: THREADS_TIMELINE_PANEL_PATH,
    component: ThreadsTimelinePanel,
  });
});
