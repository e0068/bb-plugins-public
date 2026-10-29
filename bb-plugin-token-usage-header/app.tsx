// bb-plugin-token-usage-header — frontend entry.
//
// One thread-header control: a compact button showing the session's total
// token spend. A click opens what the `headerClick` setting picks — a popover
// with the session chart and breakdown card, or the session page in the
// thread's right panel (the "session" thread panel action). Mounted once per
// visible thread (twice in a split view) — all state lives in the
// component, never at module scope.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useRpc,
  useSettings,
  type PluginNavPanelProps,
  type PluginRpcResult,
  type PluginThreadHeaderActionProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { ReducedColorsProvider } from "@bb-plugins/reduced-colors";
import { registerRailCollapse, registerSelectedThread, useFollowSelectedThread } from "@bb-plugins/rail-collapse";
import { USAGE_PLUGIN_ID } from "@/lib/plugin-id";
import type { rpcContract, threadSessionRpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  DEFAULT_VIZ_SETTINGS,
  formatPrice,
  formatTokenCount,
  parseChartMetric,
  parseGearSettings,
  parseHeaderClick,
  type ChartSettings,
  type ThreadEntry,
} from "./src/core";
import { AgentTimelinePage, buildAgentDetailSubPath, THREADS_TIMELINE_PANEL_PATH } from "./pages/AgentTimelinePage";
import { ThreadsTimelinePage } from "./pages/ThreadsTimelinePage";
import { SessionChartCard } from "./pages/thread-chart";
import { SessionSummary } from "./pages/SessionSummary";
import { ChartColorSchemeProvider } from "./pages/chart-color-scheme";
import { ChartColorsSettings } from "./pages/ChartColorsSettings";
import { requestSessionPanelRefresh, SessionPanelTab } from "./pages/SessionPanelTab";

/** The thread panel action that hosts the session page in the right panel. */
const SESSION_PANEL_ACTION_ID = "session";

type SessionTokenUsage = PluginRpcResult<(typeof rpcContract)["sessionTokenUsage"]>;
type ReadyUsage = Extract<SessionTokenUsage, { status: "ready" }>;

type LoadState =
  | { kind: "loading" }
  | { kind: "no-session" }
  | { kind: "error"; message: string }
  | { kind: "ready"; usage: ReadyUsage };

/** The chart colour scheme and Reduced Colors for every chart under one mount — loaded once, not per chart (packages/reduced-colors). */
function WithChartColors({ children }: { children: ReactNode }) {
  const rpc = useRpc<typeof rpcContract>();
  return (
    <ChartColorSchemeProvider load={() => rpc.call("loadChartColorScheme", {})}>
      <ReducedColorsProvider load={() => rpc.call("loadReducedColors", {})}>{children}</ReducedColorsProvider>
    </ChartColorSchemeProvider>
  );
}

/** The settings page's own Chart Colors block — bb's declared settings have no colour field. */
function ChartColorsSettingsSection() {
  const rpc = useRpc<typeof rpcContract>();
  return (
    <ChartColorsSettings
      loadScheme={() => rpc.call("loadChartColorScheme", {})}
      saveScheme={(scheme) => rpc.call("saveChartColorScheme", { scheme })}
      loadReducedColors={() => rpc.call("loadReducedColors", {})}
      saveReducedColors={(value) => rpc.call("saveReducedColors", value)}
    />
  );
}

function TokenUsagePanelTab(props: PluginThreadPanelProps) {
  return (
    <WithChartColors>
      <SessionPanelTab {...props} />
    </WithChartColors>
  );
}

function TokenUsageHeaderAction(props: PluginThreadHeaderActionProps) {
  return (
    <WithChartColors>
      <TokenUsageHeaderButton {...props} />
    </WithChartColors>
  );
}

function TokenUsageHeaderButton({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
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
  const opensPanel = parseHeaderClick(settingsState.values) === "panel";
  const chartMetric = parseChartMetric(settingsState.values);
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
  // The right panel draws its own chart — fetch this one only for the popover.
  const chartSessionId = state.kind === "ready" && !opensPanel ? state.usage.sessionId : null;
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

  // An already open tab only gets focused by the host — reload it too. A
  // surface without a side panel declines the open; then the session page
  // opens in Usage Analytics instead, once the session is known.
  function openSessionPanel() {
    load();
    if (navigate.openThreadPanel({ actionId: SESSION_PANEL_ACTION_ID })) requestSessionPanelRefresh(threadId);
    else if (state.kind === "ready") openAgentDetails("main", state.usage.sessionId);
  }

  const isError = state.kind === "error";
  const buttonText =
    state.kind === "ready"
      ? `${formatTokenCount(state.usage.totals.total)} · ${formatPrice(state.usage.totals.cost, state.usage.totals.unpricedModels)}`
      : state.kind === "no-session"
        ? "–"
        : state.kind === "loading"
          ? "…"
          : "";
  const ariaLabel =
    state.kind === "ready"
      ? `Token usage: ${formatTokenCount(state.usage.totals.total)}, ${formatPrice(state.usage.totals.cost, state.usage.totals.unpricedModels)}`
      : state.kind === "no-session"
        ? "Token usage: session not started yet"
        : state.kind === "loading"
          ? "Token usage: loading"
          : `Token usage: error — ${state.message}`;

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={ariaLabel}
      className="h-7 gap-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground data-[state=open]:text-foreground"
      onClick={opensPanel ? openSessionPanel : undefined}
    >
      <Icon name={isError ? "AlertCircle" : "ChartColumn"} className={cn("size-3.5", isError && "text-destructive")} aria-hidden="true" />
      {/* The SDK's contract for isCompactViewport: "Collapse to an
          icon-sized control when it is true — the row is short." The
          number stays available via aria-label. */}
      {buttonText && !isCompactViewport && <span className={cn(isError && "text-destructive")}>{buttonText}</span>}
    </Button>
  );
  if (opensPanel) return trigger;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) load();
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="max-h-[70vh] w-80 space-y-3 overflow-y-auto">
        {state.kind === "loading" && <p className="text-sm text-muted-foreground">Loading…</p>}
        {state.kind === "no-session" && (
          <p className="text-sm text-muted-foreground">
            Session hasn't started yet — the counter appears after the first response.
          </p>
        )}
        {state.kind === "error" && <p className="text-sm text-destructive">{state.message}</p>}
        {/* The session page without its right column: the same chart and
            breakdown card, fed by the light sessionTokenUsage call. */}
        {state.kind === "ready" && sessionChart && (
          <SessionChartCard
            thread={sessionChart.thread}
            agentLabels={sessionChart.agentLabels}
            settings={chartSettings}
            metric={chartMetric}
            fillWidth={chartSettings.fillWidthPopover}
          />
        )}
        {state.kind === "ready" && (
          <SessionSummary
            totals={state.usage.totals}
            agents={state.usage.agents}
            truncated={state.usage.truncated}
            onSelectAgent={(agentKey) => openAgentDetails(agentKey, state.usage.sessionId)}
          />
        )}
      </PopoverContent>
    </Popover>
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
  const rpc = useRpc<typeof threadSessionRpcContract>();
  const navigate = useBbNavigate();
  // With "Show the selected thread" on, the feed gives way to the session page
  // of the thread the owner came from or picked in the threads panel.
  useFollowSelectedThread(useSettings, subPath === "", {
    resolve: (threadId) =>
      rpc.call("threadSession", { threadId }).then(({ sessionId }) =>
        sessionId === null
          ? null
          : () =>
              navigate.toPluginPanel(THREADS_TIMELINE_PANEL_PATH, {
                subPath: buildAgentDetailSubPath({ agent: "main", session: sessionId }),
                replace: true,
              }),
      ),
    openThread: (threadId) => navigate.toThread(threadId),
  });
  return (
    <WithChartColors>
      {subPath === "" ? <ThreadsTimelinePage subPath={subPath} /> : <AgentTimelinePage subPath={subPath} />}
    </WithChartColors>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "token-usage-header",
    title: "Token usage",
    component: TokenUsageHeaderAction,
  });

  app.slots.threadPanelAction({
    id: SESSION_PANEL_ACTION_ID,
    title: "Token usage",
    icon: "ChartColumn",
    layout: "flush",
    component: TokenUsagePanelTab,
  });

  app.slots.navPanel({
    id: "threads-timeline",
    title: "Usage Analytics",
    icon: "ChartColumn",
    path: THREADS_TIMELINE_PANEL_PATH,
    component: ThreadsTimelinePanel,
  });

  // A click on the Usage Analytics icon in the left rail collapses the
  // threads panel when the owner turned it on.
  registerRailCollapse(app, USAGE_PLUGIN_ID, useSettings);
  registerSelectedThread(app, USAGE_PLUGIN_ID, useSettings);

  app.slots.settingsSection({
    id: "chart-colors",
    title: "Chart Colors",
    description: "How the charts colour agents: by palette, by the model they ran on, or by a gradient of two colours.",
    component: ChartColorsSettingsSection,
  });
});
