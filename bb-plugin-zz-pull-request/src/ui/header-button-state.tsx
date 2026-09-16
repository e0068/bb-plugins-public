// The shared machinery every thread-header button leans on: one subscription
// scheme and the button's class. Not a button itself — the buttons live in
// ./header-buttons; this is the one helper they all import.
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useRealtime } from "@get-bb/plugin-sdk/app";
import { republishSourceOf, shownBy, type ShowActionId } from "@/src/core/automation";
import { useAutomationRules } from "@/src/ui/automation-rules";

// A byte-for-byte override of the native header "Squash Merge"/"Merge" button
// (variant outline size sm), extracted from the bb bundle: h-7/px-2/cursor-pointer
// is part of the shared base class `_n`, the rest is the override itself. We
// used to have extra text-muted-foreground and hover:text-foreground (the
// latter already comes from variant=outline) — they made the button text
// noticeably lighter than the native one; gap-1.5 narrowed the gap below the
// button's standard gap-2 from its base cva classes. All three are removed.
export const HEADER_ACTION_CLASS =
  "h-7 border-border/70 bg-transparent px-2 font-normal hover:bg-state-hover";

// "changed" has no event kind for a PR status change on its own — only for
// git-refs/environment status. Closing or merging a PR by hand on GitHub
// touches none of that, so "changed" may never fire for it. We poll every 20
// seconds as a safety net — cheap (a single RPC), more reliable than waiting
// on an event that doesn't exist.
const POLL_INTERVAL_MS = 20_000;

/**
 * The shared subscription scheme for all header button states, driven by the
 * show action's rules (src/core/automation.ts): a button whose `show` action
 * is in no rule stays hidden and asks nothing; otherwise it fetches on
 * `state.open`, refetches on "changed" when the server names one of its state
 * triggers or a refresh, and polls every {@link POLL_INTERVAL_MS} on
 * `state.poll` (a PR status change on GitHub fires no event — polling catches
 * that). On the default rules that is exactly the old scheme: initial fetch +
 * every "changed" + the poll.
 */
export function usePolledState<T>(
  fetch: () => Promise<T>,
  fallback: T,
  mounted: RefObject<boolean>,
  show: ShowActionId,
): T {
  const { rules } = useAutomationRules();
  const triggers = useMemo(() => shownBy(rules, show), [rules, show]);
  const enabled = triggers.size > 0;
  const onOpen = triggers.has("state.open");
  const onPoll = triggers.has("state.poll");
  const [state, setState] = useState<T>(fallback);
  const refresh = useCallback(() => {
    fetch().then(
      (next) => {
        if (mounted.current) setState(next);
      },
      () => {
        if (mounted.current) setState(fallback);
      },
    );
  }, [fetch, fallback, mounted]);

  useEffect(() => {
    if (enabled && onOpen) refresh();
  }, [refresh, enabled, onOpen]);
  // The host may keep the first handler it was given, so the handler reads the
  // latest rules through a ref instead of closing over this render's.
  const onChanged = useRef<(payload: unknown) => void>(() => {});
  onChanged.current = (payload) => {
    if (!enabled) return;
    const source = republishSourceOf(payload);
    if (source === "refresh" || triggers.has(source)) refresh();
  };
  useRealtime(
    "changed",
    useCallback((payload: unknown) => onChanged.current(payload), []),
  );
  useEffect(() => {
    if (!enabled || !onPoll) return;
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh, enabled, onPoll]);
  return enabled ? state : fallback;
}

const VISIBLE_FALLBACK: { visible: boolean } = { visible: false };

/** Subscription to a button's visibility state. */
export function useVisible(
  fetch: () => Promise<{ visible: boolean }>,
  mounted: RefObject<boolean>,
  show: ShowActionId,
): boolean {
  return usePolledState(fetch, VISIBLE_FALLBACK, mounted, show).visible;
}

export function useMounted(): RefObject<boolean> {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}
