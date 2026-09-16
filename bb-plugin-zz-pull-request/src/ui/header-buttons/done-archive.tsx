// Rightmost-slot phase 3: the work has landed in main and the tree is clean →
// mark the linked task(s) done and archive. Follows Merge (./merge), taking
// the same slot once the PR is merged — see decideArchiveVisible in
// src/core/archive-readiness.ts.
//
// The button has two faces. Normally it reads "Done & Archive". When the
// landing is proven but the working copy could not be read — a retiring
// environment answering through local git alone — it wears the warning face
// instead of disappearing, and hovering restores the action label.
import { useCallback, useState } from "react";
import { useRpc, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { archiveButtonFace, type ArchiveButtonFace } from "@/src/core/archive-button-face";
import { errorNotification, threadArchivedNotifications } from "@/src/core/notification";
import { useClickNotify } from "@/src/ui/automation-rules";
import { HEADER_ACTION_CLASS, useMounted, usePolledState } from "@/src/ui/header-button-state";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import type { ArchiveStateReason, rpcContract } from "@/server";

// The fallback stands in whenever the RPC itself fails, so it has to be the
// most conservative answer there is: nothing was measured, button hidden.
const ARCHIVE_STATE_FALLBACK: { visible: boolean; reason: ArchiveStateReason } = {
  visible: false,
  reason: "landing-unknown",
};

const ARCHIVE_FACE_ICON: Record<ArchiveButtonFace, IconName> = {
  action: "Archive",
  submitting: "Loading",
  warning: "AlertTriangle",
};

const ARCHIVE_HINT = "Archive the thread (marks any linked task done first)";
const UNVERIFIED_HINT =
  "The work is in main, but the working copy could not be checked for uncommitted changes. Click to archive anyway (marks any linked task done first).";

export function DoneArchiveHeaderAction({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const notifyFor = useClickNotify();
  const mounted = useMounted();
  const [submitting, setSubmitting] = useState(false);
  const [archived, setArchived] = useState(false);
  const [hovering, setHovering] = useState(false);
  const fetch = useCallback(() => rpc.call("archiveState", { threadId }), [rpc, threadId]);
  const { visible, reason } = usePolledState(fetch, ARCHIVE_STATE_FALLBACK, mounted, "show.archive");
  // Which of the three faces to wear is decided in
  // src/core/archive-button-face.ts, so the rule is testable without a DOM.
  const face = archiveButtonFace({ reason, hovering, submitting });

  const archive = useCallback(() => {
    if (submitting) return;
    setSubmitting(true);
    rpc.call("archiveThread", { threadId }).then(
      (result) => {
        // Set once and never unset, same reasoning as PullRequestHeaderAction's
        // `created`: hide on our own knowledge right away, without waiting for
        // the next archiveState refetch.
        if (mounted.current) setArchived(true);
        notifyFor("click.archive", threadArchivedNotifications(result));
      },
      (error: unknown) => {
        if (mounted.current) setSubmitting(false);
        notifyFor("click.archive", errorNotification(error, "Could not archive the thread."));
      },
    );
  }, [rpc, submitting, threadId, mounted, notifyFor]);

  if (!visible || archived) return null;

  return (
    <Button
      aria-label={face === "warning" ? UNVERIFIED_HINT : ARCHIVE_HINT}
      className={HEADER_ACTION_CLASS}
      disabled={submitting}
      onClick={archive}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      size="sm"
      type="button"
      variant="outline"
    >
      <Icon
        aria-hidden="true"
        className={face === "submitting" ? "size-3.5 animate-spin" : "size-3.5"}
        name={ARCHIVE_FACE_ICON[face]}
      />
      {face === "warning" ? "tree unchecked" : "Done & Archive"}
    </Button>
  );
}
