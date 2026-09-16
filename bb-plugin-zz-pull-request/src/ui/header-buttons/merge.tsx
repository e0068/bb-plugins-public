// Rightmost-slot phase 2: a live PR exists → merge it. Follows Pull Request
// (./pull-request) — "Pull Request turns off exactly when Merge turns on, the
// same button role at two stages of the PR's life". After a merge this slot
// turns off and, if the local main could not be pulled, hands over to the
// main-not-pulled badge (./main-not-pulled) it renders in its place; once the
// work has landed and the tree is clean, Done & Archive (./done-archive) takes
// the slot.
import { useCallback, useState } from "react";
import { useRpc, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import {
  errorNotification,
  mergeErrorNotification,
  prMergedArchivedNotifications,
  prMergedNotifications,
} from "@/src/core/notification";
import { mergeButtonLabel } from "@/src/core/merge-button-label";
import { useClickNotify } from "@/src/ui/automation-rules";
import { HEADER_ACTION_CLASS, useMounted, usePolledState } from "@/src/ui/header-button-state";
import {
  MainPullRetryBadge,
  MAIN_PULL_STATE_FALLBACK,
} from "@/src/ui/header-buttons/main-not-pulled";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { rpcContract } from "@/server";

interface MergeState {
  visible: boolean;
  indicator: "success" | "failure" | "pending" | "neutral" | "unknown" | "conflict";
  prUrl: string | null;
  number: number | null;
}

const MERGE_STATE_FALLBACK: MergeState = {
  visible: false,
  indicator: "unknown",
  prUrl: null,
  number: null,
};

// The Merge button's icon reflects the PR's aggregated checks status
// (checks.state from bb, see src/core/merge-readiness.ts): "Pull Request"
// turns off exactly when "Merge" turns on — it's the same button role at
// two stages of the PR's life.
// "conflict" pre-empts the checks glyph entirely (see decideMergeReadiness):
// GitHub refuses the merge outright on a real conflict, regardless of what
// checks say, so the button must not read "checks passed"/"no checks" then.
const MERGE_INDICATOR_ICON: Record<MergeState["indicator"], IconName> = {
  success: "CircleCheck",
  failure: "CircleX",
  pending: "Clock",
  neutral: "GitMerge",
  unknown: "CircleQuestion",
  conflict: "AlertTriangle",
};

const MERGE_INDICATOR_LABEL: Record<MergeState["indicator"], string> = {
  success: "checks passed",
  failure: "checks failed",
  pending: "checks running",
  neutral: "no checks",
  unknown: "checks status unknown",
  conflict: "merge conflicts — resolve before merging",
};

export function MergeHeaderAction({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const notifyFor = useClickNotify();
  const mounted = useMounted();
  const [submitting, setSubmitting] = useState(false);
  // Set once "Merge then Archive" succeeds, and never unset — same reasoning
  // as PullRequestHeaderAction's `created`: the thread is gone, hide on our
  // own knowledge instead of waiting for the next refetch.
  const [archived, setArchived] = useState(false);
  // Hover only swaps the PR-link segment's icon (pull-request → external-link),
  // the same view-only trick MainPullRetryBadge uses — no domain state.
  const [hovering, setHovering] = useState(false);
  const fetchMerge = useCallback(() => rpc.call("mergeState", { threadId }), [rpc, threadId]);
  // `number` and `prUrl` come from here, not from the merge result: the state
  // the button is already drawn from is what names the PR in its notification.
  const { visible, indicator, number, prUrl } = usePolledState(fetchMerge, MERGE_STATE_FALLBACK, mounted, "show.merge");
  // After a merge the button turns off (visible: false) — in its place we
  // show whether the local main got pulled (see
  // memory/decisions/local-main-pull-after-merge.md).
  const fetchMainPull = useCallback(
    () => rpc.call("mainPullState", { threadId }),
    [rpc, threadId],
  );
  const mainPull = usePolledState(fetchMainPull, MAIN_PULL_STATE_FALLBACK, mounted, "show.main-not-pulled");

  const merge = useCallback(() => {
    if (submitting) return;
    setSubmitting(true);
    rpc.call("mergePr", { threadId }).then(
      (result) => {
        if (mounted.current) setSubmitting(false);
        // One notification, not three. The version bump, the reinstall and the
        // main pull are things the merge did, not news of their own — they are
        // detail lines under it. Only a main that did NOT pull stays out: the
        // "main not pulled" badge takes the button's place on the next refetch.
        notifyFor("click.merge", prMergedNotifications({ pr: { number, url: prUrl }, ...result }));
      },
      (error: unknown) => {
        if (mounted.current) setSubmitting(false);
        notifyFor("click.merge",
          mergeErrorNotification(
            error,
            "Could not merge the Pull Request.",
            { number, url: prUrl },
            { id: threadId, label: "Open thread" },
          ),
        );
      },
    );
  }, [rpc, submitting, threadId, mounted, notifyFor, number, prUrl]);

  const mergeThenArchive = useCallback(() => {
    if (submitting) return;
    setSubmitting(true);
    rpc.call("mergeArchivePr", { threadId }).then(
      (result) => {
        // An archive that refused leaves the thread where it was, so the
        // control stays: only a real archive hides it on our own knowledge.
        if (mounted.current) {
          setArchived(result.archived);
          if (!result.archived) setSubmitting(false);
        }
        // Same shape as the plain merge's notification, with the archive as
        // one more detail line under it — see prMergedArchivedNotifications.
        notifyFor("click.merge-archive",
          prMergedArchivedNotifications(
            { pr: { number, url: prUrl }, ...result },
            { id: threadId, label: "Open thread" },
          ),
        );
      },
      (error: unknown) => {
        if (mounted.current) setSubmitting(false);
        notifyFor("click.merge-archive",
          mergeErrorNotification(
            error,
            "Could not merge and archive the Pull Request.",
            { number, url: prUrl },
            { id: threadId, label: "Open thread" },
          ),
        );
      },
    );
  }, [rpc, submitting, threadId, mounted, notifyFor, number, prUrl]);

  if (archived) return null;
  if (!visible) {
    if (!mainPull.attempted || mainPull.ok) return null;
    return <MainPullRetryBadge threadId={threadId} reason={mainPull.reason} />;
  }

  // A real conflict blocks the click: GitHub would just refuse the request
  // (see decideMergeReadiness), and the label says so instead of the PR
  // number so it reads the same as GitHub's own "Merge conflicts" state.
  const conflicting = indicator === "conflict";
  // The link segment needs both halves of the address; either coming back
  // null (a best-effort field) drops it and moves the number into the action.
  const linked = prUrl !== null && number !== null;
  const label = mergeButtonLabel({ conflicting, number, linked });

  // A three-segment split control: the PR link out to GitHub (its
  // pull-request glyph turns into an external-link one on hover), the Merge
  // action carrying the checks-status icon, and the chevron with the
  // composite actions — built like PullRequestHeaderAction's two-segment one.
  // Reads as "this is PR #275 — and here's its Merge button".
  //
  // The conflict that blocks the merge blocks the dropdown too (every item in
  // it starts with the same merge GitHub would refuse) but never the link:
  // that is exactly where one goes to resolve the conflict.
  return (
    <DropdownMenu>
      <div className="flex items-center">
        {linked && (
          <Button
            aria-label={`Open Pull Request #${number} on GitHub`}
            asChild
            className={cn(HEADER_ACTION_CLASS, "rounded-r-none border-r-0")}
            size="sm"
            variant="outline"
          >
            <a
              href={prUrl}
              onMouseEnter={() => setHovering(true)}
              onMouseLeave={() => setHovering(false)}
              rel="noopener noreferrer"
              target="_blank"
            >
              <Icon
                aria-hidden="true"
                className="size-3.5"
                name={hovering ? "ExternalLink" : "GitPullRequest"}
              />
              {`PR #${number}`}
            </a>
          </Button>
        )}
        <Button
          aria-label={`${label} Pull Request (${MERGE_INDICATOR_LABEL[indicator]})`}
          className={cn(
            HEADER_ACTION_CLASS,
            "border-r-0",
            linked ? "rounded-none" : "rounded-r-none",
          )}
          disabled={submitting || conflicting}
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
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="More Merge actions"
            className={cn(HEADER_ACTION_CLASS, "rounded-l-none px-1")}
            disabled={submitting || conflicting}
            size="sm"
            type="button"
            variant="outline"
          >
            <Icon aria-hidden="true" className="size-3.5" name="ChevronDown" />
          </Button>
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={submitting} onSelect={mergeThenArchive}>
          Merge then Archive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
