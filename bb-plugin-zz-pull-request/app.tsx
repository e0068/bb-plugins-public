// bb-plugin-zz-pull-request — thread header buttons: "Wake Up", "Pull Request",
// "Fast Forward", "Merge" (and its "main not pulled" badge after a merge).
//
// "Wake Up" rides along in this plugin (not its own) because the user asked
// for it right next to the PR button, not because it's about pull requests —
// see decideWakeUpVisible in src/core/retiring.ts.
//
// UI layer: asks the backend whether to show a button (wakeUpState / prState /
// fastForwardState / mergeState / mainPullState), and on click requests an
// action (wakeUp / createPr / fastForward / mergePr). No git, no GitHub here
// — only rpc calls.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  definePluginApp,
  useRealtime,
  useRpc,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { rpcContract } from "./server";

// A byte-for-byte override of the native header "Squash Merge"/"Merge" button
// (variant outline size sm), extracted from the bb bundle: h-7/px-2/cursor-pointer
// is part of the shared base class `_n`, the rest is the override itself. We
// used to have extra text-muted-foreground and hover:text-foreground (the
// latter already comes from variant=outline) — they made the button text
// noticeably lighter than the native one; gap-1.5 narrowed the gap below the
// button's standard gap-2 from its base cva classes. All three are removed.
const HEADER_ACTION_CLASS =
  "h-7 border-border/70 bg-transparent px-2 font-normal hover:bg-state-hover";

// "changed" has no event kind for a PR status change on its own — only for
// git-refs/environment status. Closing or merging a PR by hand on GitHub
// touches none of that, so "changed" may never fire for it. We poll every 20
// seconds as a safety net — cheap (a single RPC), more reliable than waiting
// on an event that doesn't exist.
const POLL_INTERVAL_MS = 20_000;

/**
 * The shared subscription scheme for all header button states: initial
 * fetch + refetch on "changed" (a commit/branch change/refs in the
 * environment) + polling every {@link POLL_INTERVAL_MS} (a PR status change
 * on GitHub doesn't fire "changed" on its own — polling catches that). The
 * three states (PR/Fast Forward visibility, mergeState, mainPullState)
 * differ only in the response shape and the error fallback — the
 * subscription itself is one and the same.
 */
function usePolledState<T>(
  fetch: () => Promise<T>,
  fallback: T,
  mounted: RefObject<boolean>,
): T {
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
    refresh();
  }, [refresh]);
  useRealtime("changed", refresh);
  useEffect(() => {
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);
  return state;
}

const VISIBLE_FALLBACK: { visible: boolean } = { visible: false };

/** Subscription to a button's visibility state. */
function useVisible(
  fetch: () => Promise<{ visible: boolean }>,
  mounted: RefObject<boolean>,
): boolean {
  return usePolledState(fetch, VISIBLE_FALLBACK, mounted).visible;
}

interface MergeState {
  visible: boolean;
  indicator: "success" | "failure" | "pending" | "neutral" | "unknown";
  prUrl: string | null;
  number: number | null;
}

const MERGE_STATE_FALLBACK: MergeState = {
  visible: false,
  indicator: "unknown",
  prUrl: null,
  number: null,
};

interface MainPullState {
  attempted: boolean;
  ok: boolean;
  reason: string | null;
}

const MAIN_PULL_STATE_FALLBACK: MainPullState = { attempted: false, ok: true, reason: null };

function useMounted(): RefObject<boolean> {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

interface PrButtonState {
  visible: boolean;
  /** Best-effort preview of the number GitHub will assign the PR; `null` when it couldn't be determined. */
  nextNumber: number | null;
}

const PR_BUTTON_STATE_FALLBACK: PrButtonState = { visible: false, nextNumber: null };

function PullRequestHeaderAction({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const mounted = useMounted();
  const [submitting, setSubmitting] = useState(false);
  // Set once createPr succeeds, and never unset: it hides the button on our
  // own knowledge that the PR now exists, without waiting for the next
  // prState refetch (an event round trip, or up to POLL_INTERVAL_MS) — that
  // wait previously left the button enabled and clickable a second time.
  const [created, setCreated] = useState(false);
  const fetch = useCallback(
    () => rpc.call("prState", { threadId }),
    [rpc, threadId],
  );
  const { visible, nextNumber } = usePolledState(fetch, PR_BUTTON_STATE_FALLBACK, mounted);

  const create = useCallback(() => {
    if (submitting) return;
    setSubmitting(true);
    rpc.call("createPr", { threadId }).then(
      ({ number }) => {
        if (mounted.current) setCreated(true);
        // We don't open a browser tab: merge is available right in BB.
        toast.success(`Pull Request #${number} opened`);
      },
      (error: unknown) => {
        if (mounted.current) setSubmitting(false);
        toast.error(errorText(error, "Could not open the Pull Request."));
      },
    );
  }, [rpc, submitting, threadId, mounted]);

  const createThenMerge = useCallback(() => {
    if (submitting) return;
    setSubmitting(true);
    rpc.call("createAndMergePr", { threadId }).then(
      ({ number, mainPull }) => {
        if (mounted.current) setCreated(true);
        toast.success(`Pull Request #${number} opened and merged`);
        if (mainPull?.ok) toast.success("main pulled");
      },
      (error: unknown) => {
        if (mounted.current) setSubmitting(false);
        toast.error(errorText(error, "Could not open and merge the Pull Request."));
      },
    );
  }, [rpc, submitting, threadId, mounted]);

  if (!visible || created) return null;

  return (
    <DropdownMenu>
      <div className="flex items-center">
        <Button
          aria-label={
            nextNumber === null ? "Open Pull Request" : `Open Pull Request #${nextNumber}`
          }
          className={cn(HEADER_ACTION_CLASS, "rounded-r-none border-r-0")}
          disabled={submitting}
          onClick={create}
          size="sm"
          type="button"
          variant="outline"
        >
          <Icon
            aria-hidden="true"
            className={submitting ? "size-3.5 animate-spin" : "size-3.5"}
            name={submitting ? "Loading" : "GitPullRequest"}
          />
          {nextNumber === null ? "PR" : `PR #${nextNumber}`}
        </Button>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="More Pull Request actions"
            className={cn(HEADER_ACTION_CLASS, "rounded-l-none px-1")}
            disabled={submitting}
            size="sm"
            type="button"
            variant="outline"
          >
            <Icon aria-hidden="true" className="size-3.5" name="ChevronDown" />
          </Button>
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={submitting} onSelect={createThenMerge}>
          Pull Request then Merge
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WakeUpHeaderAction({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const mounted = useMounted();
  const [submitting, setSubmitting] = useState(false);
  const fetch = useCallback(() => rpc.call("wakeUpState", { threadId }), [rpc, threadId]);
  const visible = useVisible(fetch, mounted);

  const wakeUp = useCallback(() => {
    if (submitting) return;
    setSubmitting(true);
    rpc.call("wakeUp", { threadId }).then(
      () => {
        if (mounted.current) setSubmitting(false);
        // The environment goes back to "ready" — republishAfterMutation on
        // the backend already covers the refetch, no need to hide locally.
        toast.success("Thread woken up");
      },
      (error: unknown) => {
        if (mounted.current) setSubmitting(false);
        toast.error(errorText(error, "Could not wake up the thread."));
      },
    );
  }, [rpc, submitting, threadId, mounted]);

  if (!visible) return null;

  return (
    <Button
      aria-label="Wake up the retired thread"
      className={HEADER_ACTION_CLASS}
      disabled={submitting}
      onClick={wakeUp}
      size="sm"
      type="button"
      variant="outline"
    >
      <Icon
        aria-hidden="true"
        className={submitting ? "size-3.5 animate-spin" : "size-3.5"}
        name={submitting ? "Loading" : "Zap"}
      />
      Wake Up
    </Button>
  );
}

function FastForwardHeaderAction({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const mounted = useMounted();
  const [submitting, setSubmitting] = useState(false);
  const fetch = useCallback(
    () => rpc.call("fastForwardState", { threadId }),
    [rpc, threadId],
  );
  const visible = useVisible(fetch, mounted);

  const run = useCallback(() => {
    if (submitting) return;
    setSubmitting(true);
    rpc.call("fastForward", { threadId }).then(
      () => {
        if (mounted.current) setSubmitting(false);
        // The branch was fast-forwarded — "changed" will refetch state and hide the button.
        toast.success("Branch fast-forwarded to main");
      },
      (error: unknown) => {
        if (mounted.current) setSubmitting(false);
        toast.error(errorText(error, "Could not fast-forward the branch."));
      },
    );
  }, [rpc, submitting, threadId, mounted]);

  if (!visible) return null;

  return (
    <Button
      aria-label="Catch up with main (fast-forward)"
      className={HEADER_ACTION_CLASS}
      disabled={submitting}
      onClick={run}
      size="sm"
      type="button"
      variant="outline"
    >
      <Icon
        aria-hidden="true"
        className={submitting ? "size-3.5 animate-spin" : "size-3.5"}
        name={submitting ? "Loading" : "ArrowDown"}
      />
      Fast Forward
    </Button>
  );
}

// The Merge button's icon reflects the PR's aggregated checks status
// (checks.state from bb, see src/core/merge-readiness.ts): "Pull Request"
// turns off exactly when "Merge" turns on — it's the same button role at
// two stages of the PR's life.
const MERGE_INDICATOR_ICON: Record<MergeState["indicator"], IconName> = {
  success: "CircleCheck",
  failure: "CircleX",
  pending: "Clock",
  neutral: "GitMerge",
  unknown: "CircleQuestion",
};

const MERGE_INDICATOR_LABEL: Record<MergeState["indicator"], string> = {
  success: "checks passed",
  failure: "checks failed",
  pending: "checks running",
  neutral: "no checks",
  unknown: "checks status unknown",
};

function MergeHeaderAction({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const mounted = useMounted();
  const [submitting, setSubmitting] = useState(false);
  const fetchMerge = useCallback(() => rpc.call("mergeState", { threadId }), [rpc, threadId]);
  const { visible, indicator, number } = usePolledState(fetchMerge, MERGE_STATE_FALLBACK, mounted);
  // After a merge the button turns off (visible: false) — in its place we
  // show whether the local main got pulled (see
  // memory/decisions/local-main-pull-after-merge.md).
  const fetchMainPull = useCallback(
    () => rpc.call("mainPullState", { threadId }),
    [rpc, threadId],
  );
  const mainPull = usePolledState(fetchMainPull, MAIN_PULL_STATE_FALLBACK, mounted);

  const merge = useCallback(() => {
    if (submitting) return;
    setSubmitting(true);
    rpc.call("mergePr", { threadId }).then(
      (result) => {
        if (mounted.current) setSubmitting(false);
        toast.success("Pull Request merged");
        // A separate toast about main, symmetric with MainPullRetryBadge:
        // success is quiet news on its own, failure will already be shown
        // by the "main not pulled" badge that appears in the button's place
        // on the next refetch.
        if (result.mainPull?.ok) toast.success("main pulled");
      },
      (error: unknown) => {
        if (mounted.current) setSubmitting(false);
        toast.error(errorText(error, "Could not merge the Pull Request."));
      },
    );
  }, [rpc, submitting, threadId, mounted]);

  if (!visible) {
    if (!mainPull.attempted || mainPull.ok) return null;
    return <MainPullRetryBadge threadId={threadId} reason={mainPull.reason} />;
  }

  const label = number === null ? "Merge" : `Merge #${number}`;

  return (
    <Button
      aria-label={`${label} Pull Request (${MERGE_INDICATOR_LABEL[indicator]})`}
      className={HEADER_ACTION_CLASS}
      disabled={submitting}
      onClick={merge}
      size="sm"
      type="button"
      variant="outline"
    >
      <Icon
        aria-hidden="true"
        className={submitting ? "size-3.5 animate-spin" : "size-3.5"}
        name={submitting ? "Loading" : MERGE_INDICATOR_ICON[indicator]}
      />
      {label}
    </Button>
  );
}

// Previously the main-pull KV state was written once right after mergePr and
// never updated again — there was no trigger to re-check, even once the
// failure reason (main busy in another copy) had cleared later (see
// memory/decisions/main-pull-retry-button.md). On hover the badge turns into
// "Retry": an explicit click reruns the same pull via the `retryMainPull`
// RPC, instead of just waiting for the next merge.
function MainPullRetryBadge({
  threadId,
  reason,
}: {
  threadId: string;
  reason: string | null;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const mounted = useMounted();
  const [retrying, setRetrying] = useState(false);
  const [hovering, setHovering] = useState(false);

  const retry = useCallback(() => {
    if (retrying) return;
    setRetrying(true);
    rpc.call("retryMainPull", { threadId }).then(
      (result) => {
        if (!mounted.current) return;
        setRetrying(false);
        if (result.ok) toast.success("main pulled");
        else toast.error(`Could not pull main: ${result.reason ?? "unknown reason"}`);
      },
      (error: unknown) => {
        if (mounted.current) setRetrying(false);
        toast.error(errorText(error, "Could not retry pulling main."));
      },
    );
  }, [rpc, retrying, threadId, mounted]);

  return (
    <Button
      aria-label={
        retrying
          ? "Retrying pulling main"
          : `Local main not pulled: ${reason ?? "unknown reason"}. Click to retry.`
      }
      className={HEADER_ACTION_CLASS}
      disabled={retrying}
      onClick={retry}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      size="sm"
      type="button"
      variant="outline"
    >
      <Icon
        aria-hidden="true"
        className={retrying ? "size-3.5 animate-spin" : "size-3.5"}
        name={retrying ? "Loading" : hovering ? "RotateCcw" : "AlertTriangle"}
      />
      {retrying ? "Retrying…" : hovering ? "Retry" : "main not pulled"}
    </Button>
  );
}

export default definePluginApp((app) => {
  // Registered first: when it's visible, the environment is retiring and the
  // git-dependent buttons below have nothing reliable to show yet anyway.
  app.slots.experimental_threadHeaderAction({
    id: "wake-up",
    title: "Wake up the retired thread",
    component: WakeUpHeaderAction,
  });
  app.slots.experimental_threadHeaderAction({
    id: "fast-forward",
    title: "Catch up with main (fast-forward)",
    component: FastForwardHeaderAction,
  });
  app.slots.experimental_threadHeaderAction({
    id: "pull-request",
    title: "Open Pull Request",
    component: PullRequestHeaderAction,
  });
  // Registered last among this plugin's buttons — takes the same rightmost
  // spot that the "Pull Request" button held
  // (memory/decisions/pr-button-rightmost-via-plugin-id.md) until a live PR
  // is opened: exactly one of the two is visible at any given time.
  app.slots.experimental_threadHeaderAction({
    id: "merge",
    title: "Merge Pull Request",
    component: MergeHeaderAction,
  });
});
