// A sub-state of the Merge slot (./merge), shown after a merge when the local
// main could not be fast-forwarded. It follows Merge and is rendered by it.
//
// Previously the main-pull KV state was written once right after mergePr and
// never updated again — there was no trigger to re-check, even once the
// failure reason (main busy in another copy) had cleared later (see
// memory/decisions/main-pull-retry-button.md). On hover the badge turns into
// "Retry": an explicit click reruns the same pull via the `retryMainPull`
// RPC, instead of just waiting for the next merge.
import { useCallback, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { errorNotification } from "@/src/core/notification";
import { useClickNotify } from "@/src/ui/automation-rules";
import { HEADER_ACTION_CLASS, useMounted } from "@/src/ui/header-button-state";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { rpcContract } from "@/server";

export interface MainPullState {
  attempted: boolean;
  ok: boolean;
  reason: string | null;
}

export const MAIN_PULL_STATE_FALLBACK: MainPullState = { attempted: false, ok: true, reason: null };

export function MainPullRetryBadge({
  threadId,
  reason,
}: {
  threadId: string;
  reason: string | null;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const notifyFor = useClickNotify();
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
        notifyFor("click.retry-main",
          result.ok
            ? { tone: "success", title: "main pulled", details: [], link: null }
            : {
                tone: "error",
                title: `Could not pull main: ${result.reason ?? "unknown reason"}`,
                details: [],
                link: null,
              },
        );
      },
      (error: unknown) => {
        if (mounted.current) setRetrying(false);
        notifyFor("click.retry-main", errorNotification(error, "Could not retry pulling main."));
      },
    );
  }, [rpc, retrying, threadId, mounted, notifyFor]);

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
      {/* The label swaps on hover ("main not pulled" → "Retry"); a hidden
          sizer on the widest wording holds the width so the button never
          resizes — and jitters — as the text changes. */}
      <span className="grid">
        <span aria-hidden="true" className="invisible [grid-area:1/1]">
          main not pulled
        </span>
        <span className="[grid-area:1/1] text-center">
          {retrying ? "Retrying…" : hovering ? "Retry" : "main not pulled"}
        </span>
      </span>
    </Button>
  );
}
