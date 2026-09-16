// Rightmost-slot phase 1: the thread has committed, unpushed work and no live
// PR yet → open one. Hidden once created; the Merge button (./merge) takes the
// same slot the moment a PR exists — "the same button role at two stages of
// the PR's life".
import { useCallback, useState } from "react";
import { useRpc, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import {
  errorNotification,
  prOpenedAndMergedNotifications,
  prOpenedMergedArchivedNotifications,
  prOpenedNotifications,
} from "@/src/core/notification";
import { useClickNotify } from "@/src/ui/automation-rules";
import { HEADER_ACTION_CLASS, useMounted, usePolledState } from "@/src/ui/header-button-state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { rpcContract } from "@/server";

interface PrButtonState {
  visible: boolean;
  reason: string;
  /** Best-effort preview of the number GitHub will assign the PR; `null` when it couldn't be determined. */
  nextNumber: number | null;
}

const PR_BUTTON_STATE_FALLBACK: PrButtonState = {
  visible: false,
  reason: "no-environment",
  nextNumber: null,
};

export function PullRequestHeaderAction({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const notifyFor = useClickNotify();
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
  const { visible, reason, nextNumber } = usePolledState(fetch, PR_BUTTON_STATE_FALLBACK, mounted, "show.pr");
  // git couldn't confirm the branch isn't already merged (no working copy,
  // a failed fetch, a broken `merge-tree`) — the button still works (create
  // re-measures before doing anything), but the label says so up front
  // instead of quietly claiming "ready". See refineWithMergedContent.
  const unverified = reason === "content-unknown";

  const create = useCallback(() => {
    if (submitting) return;
    setSubmitting(true);
    rpc.call("createPr", { threadId }).then(
      (result) => {
        if (mounted.current) setCreated(true);
        // We don't open a browser tab: merge is available right in BB, and
        // the notification carries the link for when GitHub is wanted.
        notifyFor("click.pr", prOpenedNotifications(result));
      },
      (error: unknown) => {
        if (mounted.current) setSubmitting(false);
        notifyFor("click.pr", errorNotification(error, "Could not open the Pull Request."));
      },
    );
  }, [rpc, submitting, threadId, mounted, notifyFor]);

  const createThenMerge = useCallback(() => {
    if (submitting) return;
    setSubmitting(true);
    rpc.call("createAndMergePr", { threadId }).then(
      (result) => {
        // The PR is open even when the merge leg came back as `failure` — the
        // button's job is done either way, and the Merge button takes over.
        if (mounted.current) setCreated(true);
        notifyFor("click.pr-merge", prOpenedAndMergedNotifications(result, { id: threadId, label: "Open thread" }));
      },
      (error: unknown) => {
        if (mounted.current) setSubmitting(false);
        notifyFor("click.pr-merge", errorNotification(error, "Could not open and merge the Pull Request."));
      },
    );
  }, [rpc, submitting, threadId, mounted, notifyFor]);

  const createMergeThenArchive = useCallback(() => {
    if (submitting) return;
    setSubmitting(true);
    rpc.call("createMergeArchivePr", { threadId }).then(
      (result) => {
        if (mounted.current) setCreated(true);
        notifyFor("click.pr-merge-archive", prOpenedMergedArchivedNotifications(result, { id: threadId, label: "Open thread" }));
      },
      (error: unknown) => {
        if (mounted.current) setSubmitting(false);
        notifyFor("click.pr-merge-archive", errorNotification(error, "Could not open, merge and archive the Pull Request."));
      },
    );
  }, [rpc, submitting, threadId, mounted, notifyFor]);

  if (!visible || created) return null;

  return (
    <DropdownMenu>
      <div className="flex items-center">
        <Button
          aria-label={
            (nextNumber === null ? "Open Pull Request" : `Open Pull Request #${nextNumber}`) +
            (unverified ? " (couldn't confirm this isn't already merged)" : "")
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
            name={submitting ? "Loading" : unverified ? "AlertTriangle" : "GitPullRequest"}
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
        <DropdownMenuItem disabled={submitting} onSelect={createMergeThenArchive}>
          Pull Request, Merge then Archive
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
