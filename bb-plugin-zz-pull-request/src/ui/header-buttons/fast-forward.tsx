// Beside the PR→Merge→Archive chain, not in it: shown whenever the branch is
// behind main and can be fast-forwarded (fastForwardState / src/core/fast-forward.ts).
// It catches the branch up; it does not depend on whether a PR exists.
import { useCallback, useState } from "react";
import { useRpc, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { errorNotification } from "@/src/core/notification";
import { useClickNotify } from "@/src/ui/automation-rules";
import { HEADER_ACTION_CLASS, useMounted, useVisible } from "@/src/ui/header-button-state";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { rpcContract } from "@/server";

export function FastForwardHeaderAction({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const notifyFor = useClickNotify();
  const mounted = useMounted();
  const [submitting, setSubmitting] = useState(false);
  const fetch = useCallback(
    () => rpc.call("fastForwardState", { threadId }),
    [rpc, threadId],
  );
  const visible = useVisible(fetch, mounted, "show.ff");

  const run = useCallback(() => {
    if (submitting) return;
    setSubmitting(true);
    rpc.call("fastForward", { threadId }).then(
      () => {
        if (mounted.current) setSubmitting(false);
        // The branch was fast-forwarded — "changed" will refetch state and hide the button.
        notifyFor("click.ff", { tone: "success", title: "Branch fast-forwarded to main", details: [], link: null });
      },
      (error: unknown) => {
        if (mounted.current) setSubmitting(false);
        notifyFor("click.ff", errorNotification(error, "Could not fast-forward the branch."));
      },
    );
  }, [rpc, submitting, threadId, mounted, notifyFor]);

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
