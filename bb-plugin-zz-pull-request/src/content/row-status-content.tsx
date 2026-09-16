// Shell (frontend) — decorates every sidebar thread row with the PR-work glyph.
//
// A content script's headless React root has no host route/thread context —
// SDK app hooks (`experimental_useSidebarThreads`, but also plain `useRpc`,
// both funnel through the same host-tree-dependent machinery) crash inside it
// (see memory/decisions/row-status-rpc-not-frontend-hooks.md). So this script
// gets its thread list from the sidebar DOM (content scripts are full-trust,
// same-origin page code — that access is exactly what they're for), the
// active thread from the route, and its git/PR facts from the plugin's own
// `rowFacts` RPC via a plain same-origin `fetch` — no SDK hook at all. All
// the deciding lives in the pure core (src/core/row-status); this file only
// reads the world and writes the glyph.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PluginAppBuilder, PluginContentScriptContext } from "@get-bb/plugin-sdk/app";
import {
  decideRowState,
  rowStateToStatus,
  withOpRunning,
  type GitPhase,
  type PrSignal,
  type RowStatus,
} from "../core/row-status";
import { DEFAULT_RULES, parseRules, type AutomationRules } from "../core/automation";
import { rowStateShown } from "../core/automation-status";
import { GLYPH_OVERRIDES, glyphOverrideCss } from "../core/row-glyph-css";
import { BUSY_OVERRIDE_ATTR, busyOverrideCss } from "../core/busy-override-css";
import { nextBusyThreads } from "../core/op-busy";
import { subscribeOpBusy } from "../wiring/op-busy-channel";
import { loadSeen, saveSeen, seenId } from "./visited-store";

type SetStatus = NonNullable<PluginContentScriptContext["experimental_setThreadRowStatus"]>;

/** The plugin's own `rowFacts` RPC output shape (mirrors server.ts's zod schema). */
type RowFacts = {
  gitPhase: GitPhase;
  pr: ({ number: number | null } & PrSignal) | null;
};

/** How often sidebar rows are re-scanned and facts re-polled. */
const POLL_INTERVAL_MS = 20_000;

/** The attribute bb's own sidebar row renders its thread id onto. */
const THREAD_ID_ATTR = "data-sidebar-thread-id";

// Content scripts get no `useRpc()` (see module doc above), but the RPC is
// still an ordinary same-origin POST any trusted page code can call directly:
// `POST /api/v1/plugins/<pluginId>/rpc/<method>` with the input as the JSON
// body, `{ ok: true, result }` on success. `pluginId` comes from the mount
// context rather than a hardcoded slug, so a package rename can't drift it.
async function fetchRowFacts(pluginId: string, threadId: string): Promise<RowFacts | null> {
  try {
    const res = await fetch(`/api/v1/plugins/${pluginId}/rpc/rowFacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId }),
    });
    if (!res.ok) return null;
    const body: { ok: boolean; result?: RowFacts } = await res.json();
    return body.ok && body.result ? body.result : null;
  } catch {
    return null;
  }
}

// The thread-status rules (src/core/automation-status.ts) over the same
// plain RPC route: which icon states the rules show. Read once per poll for
// all rows; a failed read keeps what was known, starting from the defaults.
async function fetchRules(pluginId: string): Promise<AutomationRules | null> {
  try {
    const res = await fetch(`/api/v1/plugins/${pluginId}/rpc/automationRules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    const body: { ok: boolean; result?: { rules: unknown } } = await res.json();
    return body.ok && body.result ? parseRules(body.result.rules) : null;
  } catch {
    return null;
  }
}

/** A stable content key for a status, so we only re-push the glyph on change. */
function statusKeyOf(status: RowStatus | null): string {
  return status ? `${status.icon} ${status.label} ${status.tone}` : "";
}

/** Every thread id currently rendered as a sidebar row. */
function scanSidebarThreadIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  Array.from(document.querySelectorAll(`[${THREAD_ID_ATTR}]`)).forEach((el) => {
    const id = el.getAttribute(THREAD_ID_ATTR);
    if (id) ids.add(id);
  });
  return ids;
}

/** The thread id in the current route, or null off a thread page. */
function activeThreadIdFromUrl(): string | null {
  return /\/threads\/(thr_[A-Za-z0-9]+)/.exec(location.pathname)?.[1] ?? null;
}

/** Tracks which threads the sidebar renders right now, live via MutationObserver. */
function useSidebarThreadIds(): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(scanSidebarThreadIds);
  useEffect(() => {
    const observer = new MutationObserver(() => setIds(scanSidebarThreadIds()));
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [THREAD_ID_ATTR],
    });
    return () => observer.disconnect();
  }, []);
  return ids;
}

/** Tracks the active thread id from the route, polled — pushState fires no event. */
function useActiveThreadId(tick: number): string | null {
  const [id, setId] = useState<string | null>(activeThreadIdFromUrl);
  useEffect(() => {
    setId(activeThreadIdFromUrl());
  }, [tick]);
  useEffect(() => {
    const onPop = () => setId(activeThreadIdFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return id;
}

/** Live set of threads with a PR/Merge/Archive operation in flight, off the channel. */
function useBusyThreads(): ReadonlySet<string> {
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set<string>());
  useEffect(() => {
    return subscribeOpBusy((message) => setBusy((prev) => nextBusyThreads(prev, message)));
  }, []);
  return busy;
}

// The `data-sidebar-thread-id` attribute sits on an absolutely-positioned
// overlay link that is a sibling — not an ancestor — of the row's trailing
// indicator, so it can't anchor a CSS selector to the glyph. To scope the
// question-mark override (src/core/busy-override-css.ts) we instead mark the
// row's own container: from the id-bearing link, walk up to the nearest
// ancestor that contains a trailing indicator.
//
// The single-indicator guard is what keeps this precise. The first ancestor
// that holds an indicator is this row's container only if it holds exactly
// one; more than one means we have climbed past the row boundary into a shared
// ancestor (a changed host layout, say), and marking that would mask the
// question mark on every row at once — so we bail to null (no mask) instead of
// over-applying. The depth cap is a second belt against runaway climbs.
function busyRowContainer(threadId: string): Element | null {
  const escaped =
    typeof CSS !== "undefined" && CSS.escape ? CSS.escape(threadId) : threadId;
  const link = document.querySelector(`[${THREAD_ID_ATTR}="${escaped}"]`);
  let el: Element | null = link?.parentElement ?? null;
  for (let depth = 0; el && depth < 6; depth += 1) {
    const indicators = el.querySelectorAll("[data-sidebar-thread-trailing-indicator]").length;
    if (indicators === 1) return el;
    if (indicators > 1) return null;
    el = el.parentElement;
  }
  return null;
}

/** Puts the busy marker on exactly the busy rows' containers, and nowhere else. */
function reconcileBusyMarkers(busy: ReadonlySet<string>): void {
  const wanted = new Set<Element>();
  busy.forEach((threadId) => {
    const container = busyRowContainer(threadId);
    if (container) wanted.add(container);
  });
  document.querySelectorAll(`[${BUSY_OVERRIDE_ATTR}]`).forEach((el) => {
    if (!wanted.has(el)) el.removeAttribute(BUSY_OVERRIDE_ATTR);
  });
  wanted.forEach((el) => {
    if (!el.hasAttribute(BUSY_OVERRIDE_ATTR)) el.setAttribute(BUSY_OVERRIDE_ATTR, "");
  });
}

// Keeps the busy marker attached across the host's constant row re-renders: a
// one-time set would be wiped the next time React redraws the row, so while any
// thread is busy we re-apply on every sidebar mutation (attributes we set are
// not observed, so this never re-triggers itself). When nothing is busy there
// is nothing to watch — the markers are cleared once and no observer runs.
function useBusyRowMarkers(busy: ReadonlySet<string>): void {
  useEffect(() => {
    reconcileBusyMarkers(busy);
    if (busy.size === 0) return;
    // A merge/archive runs for seconds while the agent may be streaming output,
    // firing document mutations in bursts. Coalesce each burst into one
    // reconcile per frame so the querySelectorAll sweep runs at most once a
    // frame, not once per mutation record.
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        reconcileBusyMarkers(busy);
      });
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      reconcileBusyMarkers(new Set());
    };
  }, [busy]);
}

function RowStatusApp({ pluginId, setStatus }: { pluginId: string; setStatus: SetStatus }) {
  const threadIds = useSidebarThreadIds();
  const busyThreads = useBusyThreads();
  useBusyRowMarkers(busyThreads);

  const [seen, setSeen] = useState<ReadonlySet<string>>(loadSeen);
  const markSeen = (id: string) => {
    setSeen((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      saveSeen(next);
      return next;
    });
  };

  // One shared poll signal for the rowFacts RPC: bb's own PR-attention "changed"
  // event isn't available to a content script, and a hand-merge on GitHub fires
  // no event on the host side either — a slow poll covers both, same fallback
  // app.tsx already relies on for its own buttons.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  const activeThreadId = useActiveThreadId(tick);

  const [rules, setRules] = useState<AutomationRules>(DEFAULT_RULES);
  useEffect(() => {
    let alive = true;
    fetchRules(pluginId).then((next) => {
      if (alive && next) setRules(next);
    });
    return () => {
      alive = false;
    };
  }, [pluginId, tick]);

  return (
    <>
      {[...threadIds].map((threadId) => (
        <ThreadRow
          key={threadId}
          pluginId={pluginId}
          threadId={threadId}
          isActive={threadId === activeThreadId}
          opBusy={busyThreads.has(threadId)}
          seen={seen}
          markSeen={markSeen}
          tick={tick}
          rules={rules}
          setStatus={setStatus}
        />
      ))}
    </>
  );
}

function ThreadRow({
  pluginId,
  threadId,
  isActive,
  opBusy,
  seen,
  markSeen,
  tick,
  rules,
  setStatus,
}: {
  pluginId: string;
  threadId: string;
  isActive: boolean;
  opBusy: boolean;
  seen: ReadonlySet<string>;
  markSeen: (id: string) => void;
  tick: number;
  rules: AutomationRules;
  setStatus: SetStatus;
}) {
  const [gitPhase, setGitPhase] = useState<GitPhase>("unknown");
  const [pr, setPr] = useState<RowFacts["pr"]>(null);

  useEffect(() => {
    let alive = true;
    fetchRowFacts(pluginId, threadId).then((facts) => {
      if (!alive) return;
      // A retiring environment makes `sdk.environments.status` throw, which
      // rejects the rowFacts RPC and returns `null` here. Overwriting the
      // last-known glyph with "unknown / no pr" on that null wipes the icon
      // off a still-visible thread row: a paused thread you did not close
      // stops looking like it has any state at all, and forgets to remind
      // you it is there. Keep the previous facts instead — a real transition
      // (fetch succeeded, PR closed, tree went clean) still lands normally
      // through the branches below.
      if (!facts) return;
      setGitPhase(facts.gitPhase);
      setPr(facts.pr);
    });
    return () => {
      alive = false;
    };
  }, [pluginId, threadId, tick]);

  const mergedKey = pr ? seenId(threadId, pr.number ?? -1) : null;
  const mergedSeen = mergedKey ? seen.has(mergedKey) : false;

  // Drop the merged glyph on the first visit to its thread.
  useEffect(() => {
    if (pr?.state === "merged" && mergedKey && !mergedSeen && isActive) {
      markSeen(mergedKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pr?.state, mergedKey, mergedSeen, isActive]);

  // `agentWorking` stays false on purpose: while the agent runs, the host's own
  // "runtime" spinner wins the trailing-indicator slot and our glyph is never
  // rendered (bb bundle, the `LY` oracle), so a busy tone there would be
  // invisible. The pulse we *can* show is for a PR/Merge/Archive operation —
  // `withOpRunning` forces the running tone whenever one is in flight, and
  // wherever our glyph is visible the host draws it with animate-pulse.
  const state = decideRowState({
    gitPhase,
    pr,
    agentWorking: false,
    mergedSeen,
  });
  // A state the thread-status rules leave out clears the icon instead.
  const status = withOpRunning(rowStateToStatus(rowStateShown(rules, state) ? state : { kind: "none" }), opBusy);

  const statusKey = statusKeyOf(status);
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (lastKey.current === statusKey) return;
    lastKey.current = statusKey;
    setStatus(threadId, status);
    // `status` is intentionally out of deps: `statusKey` is its content digest,
    // and the effect reads the fresh `status` from the render closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusKey, threadId, setStatus]);

  // Clear this row's glyph when it leaves the sidebar (thread archived/removed).
  useEffect(() => {
    return () => setStatus(threadId, null);
  }, [threadId, setStatus]);

  return null;
}

/** Registers the headless content script that drives the row glyphs. */
export function registerRowStatus(app: PluginAppBuilder): void {
  app.contentScripts.register({
    id: "thread-row-status",
    mount(context) {
      const setStatus = context.experimental_setThreadRowStatus;
      if (!setStatus) return; // Older host without the row-status API.

      // Redraws the two pre-PR glyphs the host has no icon name for — see
      // src/core/row-glyph-css.ts. A stylesheet rather than DOM surgery on
      // purpose: the host re-renders these rows constantly, and CSS keeps
      // applying to every fresh node without a single observer.
      const style = document.createElement("style");
      style.dataset.pullRequestRowGlyphs = "";
      // Two things in one sheet: the always-on redraw of the two pre-PR glyphs,
      // and the operation-time mask that overrides the host's "waiting for
      // input" question mark on a row marked busy (see busy-override-css.ts).
      style.textContent = `${glyphOverrideCss(GLYPH_OVERRIDES)}\n${busyOverrideCss()}`;
      document.head.append(style);

      // A detached container: this root renders no visible DOM — it only runs
      // the DOM scan/RPC polling and drives setStatus — so it never touches
      // app layout.
      const container = document.createElement("div");
      const root = createRoot(container);
      root.render(<RowStatusApp pluginId={context.pluginId} setStatus={setStatus} />);
      return () => {
        root.unmount();
        style.remove();
      };
    },
  });
}
