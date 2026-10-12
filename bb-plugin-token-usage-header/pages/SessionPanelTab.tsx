// The "Token usage" tab of a thread's right panel: the session page
// (SessionView) for the thread's own Claude Code session. Unlike the page in
// Usage Analytics, the agent pick lives in the tab — switching agents never
// navigates away from the thread.
//
// The SDK doesn't tell a tab it was opened again, so the header counter says
// so itself: requestSessionPanelRefresh(threadId) after openThreadPanel
// reloads that thread's tab in place.
import { useEffect, useState } from "react";
import { useRpc, type PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import type { threadSessionRpcContract } from "../server";
import { SessionView, type SessionSelection } from "./AgentTimelinePage";

const REFRESH_EVENT = "bb-plugin-token-usage-header:refresh-session-panel";

/** Reloads the open Token usage tab of `threadId`, if there is one. */
export function requestSessionPanelRefresh(threadId: string): void {
  window.dispatchEvent(new CustomEvent<string>(REFRESH_EVENT, { detail: threadId }));
}

const MAIN_AGENT: SessionSelection = { agent: "main" };

type SessionState = { kind: "loading" } | { kind: "none" } | { kind: "error"; message: string } | { kind: "ready"; session: string };

export function SessionPanelTab({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof threadSessionRpcContract>();
  const [refreshKey, setRefreshKey] = useState(0);
  // The pick belongs to the session it was made in — a new session starts
  // over from its main agent, the old session's agent keys mean nothing there.
  const [picked, setPicked] = useState<{ session: string; selection: SessionSelection } | null>(null);
  const [state, setState] = useState<SessionState>({ kind: "loading" });

  useEffect(() => {
    const onRefresh = (event: Event) => {
      if ((event as CustomEvent<string>).detail === threadId) setRefreshKey((key) => key + 1);
    };
    window.addEventListener(REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(REFRESH_EVENT, onRefresh);
  }, [threadId]);

  // Re-resolved on every refresh: a thread isn't tied to one session for life
  // (src/service/thread-session.ts), and a tab opened before the first
  // response picks its session up on the next counter click. The loaded page
  // stays until the answer.
  useEffect(() => {
    let cancelled = false;
    rpc.call("threadSession", { threadId }).then(
      ({ sessionId }) => {
        if (cancelled) return;
        setState((prev) =>
          sessionId === null
            ? { kind: "none" }
            : prev.kind === "ready" && prev.session === sessionId
              ? prev
              : { kind: "ready", session: sessionId },
        );
      },
      (err: unknown) => {
        if (!cancelled) setState({ kind: "error", message: err instanceof Error ? err.message : "Failed to resolve the session." });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, threadId, refreshKey]);

  if (state.kind === "loading") return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (state.kind === "error") return <p className="p-4 text-sm text-destructive">{state.message}</p>;
  if (state.kind === "none") {
    return <p className="p-4 text-sm text-muted-foreground">Session hasn't started yet — the breakdown appears after the first response.</p>;
  }
  const { session } = state;
  return (
    <SessionView
      session={session}
      selection={picked?.session === session ? picked.selection : MAIN_AGENT}
      onSelect={(selection) => setPicked({ session, selection })}
      refreshKey={refreshKey}
    />
  );
}
