// The session page's family block: when the thread that owns the open session
// started other threads, the total over the whole family and one chart card
// per thread — the thread itself first. Fetches its own data (the threadFamily
// RPC) and draws nothing when there is no family or it cannot be read, so the
// page stays what it was for a thread that started nothing.
import { useEffect, useRef, useState } from "react";
import { useRpc, type PluginRpcResult } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { Button } from "@/components/ui/button";
import { formatPrice, type ChartMetric, type ChartSettings } from "../src/core";
import { SessionSummary } from "./SessionSummary";
import { SessionChartCard } from "./thread-chart";

type ReadyFamily = Extract<PluginRpcResult<(typeof rpcContract)["threadFamily"]>, { status: "ready" }>;

/** A family needs at least two threads to be one: the thread alone is the page as it always was. */
const hasFamily = (family: ReadyFamily | null): family is ReadyFamily => family !== null && family.members.length > 1;

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function ThreadFamilyBlock({
  threadId,
  unit,
  groupWorkflows,
  refreshKey,
  settings,
  metric,
}: {
  threadId: string;
  /** The chart's bin width and workflow grouping — the family's charts are drawn the same way as the page's own. */
  unit: number;
  groupWorkflows: boolean;
  /** Bumping it reads the family again, past the server's cache. */
  refreshKey: number;
  settings: ChartSettings;
  metric: ChartMetric;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [family, setFamily] = useState<ReadyFamily | null>(null);
  const [showCharts, setShowCharts] = useState(true);
  // Same rule as the page's own loads: a bumped refreshKey asks past the cache once.
  const refreshedRef = useRef(refreshKey);

  useEffect(() => {
    let cancelled = false;
    const fresh = refreshedRef.current !== refreshKey;
    refreshedRef.current = refreshKey;
    rpc.call("threadFamily", { threadId, unit, groupWorkflows, ...(fresh && { fresh }) }).then(
      (result) => {
        if (!cancelled) setFamily(result.status === "ready" ? result : null);
      },
      () => {
        if (!cancelled) setFamily(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [rpc, threadId, unit, groupWorkflows, refreshKey]);

  if (!hasFamily(family)) return null;

  return (
    <section aria-label="Thread family" className="shrink-0 space-y-3 px-4 pt-3 @[44rem]:px-5">
      <div className="space-y-3 rounded-lg border border-border bg-popover p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-foreground">Thread family</h2>
          <span className="text-xs text-muted-foreground">{plural(family.members.length, "thread")}</span>
        </div>
        <SessionSummary totals={family.total} agents={[]} />
        {family.truncated && (
          <p className="text-xs text-subtle-foreground">Only the first {family.members.length} threads are counted — the family is larger.</p>
        )}
        {family.unreadable > 0 && <p className="text-xs text-subtle-foreground">{plural(family.unreadable, "thread")} could not be read and are left out.</p>}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Charts by thread</span>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setShowCharts((shown) => !shown)}>
          {showCharts ? "Hide charts" : "Show charts"}
        </Button>
      </div>
      {showCharts &&
        family.members.map((member) =>
          member.chart === null ? (
            <p key={member.threadId} className="text-xs text-muted-foreground">
              {member.title ?? member.threadId} — chart unavailable · {formatPrice(member.totals.cost, member.totals.unpricedModels)}
            </p>
          ) : (
            <div key={member.threadId} role="group" aria-label={`Thread: ${member.title ?? member.threadId}`}>
              <SessionChartCard
                thread={member.chart.thread}
                agentLabels={member.chart.agentLabels}
                settings={settings}
                metric={metric}
                fillWidth={settings.fillWidthSession}
              />
            </div>
          ),
        )}
    </section>
  );
}
