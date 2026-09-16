// One slot instead of five: bb wraps every `experimental_threadHeaderAction`
// registration in its own flex-item span, gap-1 apart, whether or not the
// registered component renders anything. Five separate registrations meant
// five wrapper spans regardless of how many buttons were actually visible —
// each hidden one (rendering null) still ate a gap-1 next to its neighbours,
// so Wake Up ended up looking three gaps away from Done & Archive instead of
// one. Composing all five here, as ordinary React children of one flex row,
// means a null child renders no DOM node at all — no ghost span, no ghost
// gap — so the visible buttons always sit exactly one gap-1 apart, the same
// gap-1 bb itself puts between this row and the next native control.
import type { PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { WakeUpHeaderAction } from "@/src/ui/header-buttons/wake-up";
import { FastForwardHeaderAction } from "@/src/ui/header-buttons/fast-forward";
import { PullRequestHeaderAction } from "@/src/ui/header-buttons/pull-request";
import { MergeHeaderAction } from "@/src/ui/header-buttons/merge";
import { DoneArchiveHeaderAction } from "@/src/ui/header-buttons/done-archive";

export function ThreadHeaderActions(props: PluginThreadHeaderActionProps) {
  return (
    <div className="flex items-center gap-1">
      <WakeUpHeaderAction {...props} />
      <FastForwardHeaderAction {...props} />
      <PullRequestHeaderAction {...props} />
      <MergeHeaderAction {...props} />
      <DoneArchiveHeaderAction {...props} />
    </div>
  );
}
