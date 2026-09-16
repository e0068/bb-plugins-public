// Beside the chain and above it: shown when the environment is retiring
// (wakeUpState / decideWakeUpVisible in src/core/retiring.ts). When it is
// visible the git-dependent buttons have nothing reliable to show, so it
// stands in for all of them; it "rides along in this plugin because the user
// asked for it right next to the PR button", not because it is about PRs.
import { useCallback, useState } from "react";
import { useRpc, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { errorNotification } from "@/src/core/notification";
import { useClickNotify } from "@/src/ui/automation-rules";
import { HEADER_ACTION_CLASS, useMounted, useVisible } from "@/src/ui/header-button-state";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { rpcContract } from "@/server";

export function WakeUpHeaderAction({ threadId }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const notifyFor = useClickNotify();
  const mounted = useMounted();
  const [submitting, setSubmitting] = useState(false);
  const fetch = useCallback(() => rpc.call("wakeUpState", { threadId }), [rpc, threadId]);
  const visible = useVisible(fetch, mounted, "show.wake");

  const wakeUp = useCallback(() => {
    if (submitting) return;
    setSubmitting(true);
    rpc.call("wakeUp", { threadId }).then(
      () => {
        if (mounted.current) setSubmitting(false);
        // The environment goes back to "ready" — republishAfterMutation on
        // the backend already covers the refetch, no need to hide locally.
        // No success toast either: the button disappearing is confirmation
        // enough, and a redundant one only adds noise to click on.
      },
      (error: unknown) => {
        if (mounted.current) setSubmitting(false);
        notifyFor("click.wake", errorNotification(error, "Could not wake up the thread."));
      },
    );
  }, [rpc, submitting, threadId, mounted, notifyFor]);

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
