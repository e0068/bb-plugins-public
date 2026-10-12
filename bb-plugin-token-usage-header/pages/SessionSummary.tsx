// The session's left column — totals by phase, cost, responses and the agent
// list. One card for every place the session is shown: the header popover
// (fed by sessionTokenUsage) and the session page in Usage Analytics and the
// right-panel tab (fed by agentTimeline). Both RPCs share the totals/agent
// schemas, so this card takes their fields as they come. Frameless — the
// popover and the page put it in their own box.
import type { PluginRpcResult } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { cn } from "@/lib/utils";
import { formatCost, formatPercent, formatPrice, formatTokenCount } from "../src/core";

type ReadyUsage = Extract<PluginRpcResult<(typeof rpcContract)["sessionTokenUsage"]>, { status: "ready" }>;

/**
 * The four phases of one model call, in display order: the three parts of
 * input fed in together (re-read from cache, newly cached, neither), then the
 * generated output. Thinking is already counted inside output, so it's a
 * nested line under the output row, not a fifth phase.
 */
const TOKEN_PHASES: ReadonlyArray<{ key: "cacheRead" | "cacheWrite" | "input" | "output"; label: string }> = [
  { key: "cacheRead", label: "Cache read" },
  { key: "cacheWrite", label: "Cache write" },
  { key: "input", label: "Input" },
  { key: "output", label: "Output" },
];

export function SessionSummary({
  totals,
  agents,
  truncated = false,
  isActive,
  onSelectAgent,
}: {
  totals: ReadyUsage["totals"];
  agents: ReadyUsage["agents"];
  /** The agent list was capped server-side and more rows exist. */
  truncated?: boolean;
  /** Highlights the open agent's row (or a whole workflow group); omitted — no row is highlighted. */
  isActive?: (agentKey: string) => boolean;
  /** Whole row is the click target; omitted renders the rows inert. */
  onSelectAgent?: (agentKey: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-foreground">Total tokens</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">{formatTokenCount(totals.total)}</span>
      </div>

      <dl className="space-y-1">
        {TOKEN_PHASES.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <dt>{label}</dt>
            <dd className="tabular-nums">
              {formatTokenCount(totals[key])}{" "}
              <span className="text-subtle-foreground">({formatPercent(totals[key], totals.total)})</span> ·{" "}
              {formatCost(totals.costs[key])}
            </dd>
          </div>
        ))}
        {/* Its share is of the output, not of the total — of the total it would always read "0%". */}
        <div className="flex items-center justify-between gap-2 pl-3 text-xs text-subtle-foreground">
          <dt>incl. thinking</dt>
          <dd className="tabular-nums">
            {formatTokenCount(totals.thinking)} <span>({formatPercent(totals.thinking, totals.output)})</span> ·{" "}
            {formatCost(totals.costs.thinking)}
          </dd>
        </div>
      </dl>

      <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
        <span>Cost</span>
        <span className="font-medium tabular-nums text-foreground">{formatPrice(totals.cost, totals.unpricedModels)}</span>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Responses</span>
        <span className="font-medium tabular-nums text-foreground">{totals.messages}</span>
      </div>

      {agents.length > 0 && (
        <div className="space-y-1 border-t border-border pt-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-muted-foreground">Agents</span>
            {truncated && <span className="text-xs text-subtle-foreground">not all shown</span>}
          </div>
          {/* Name and caption arrive ready from the server (formatBucketDisplay) — see
              docs/decisions/token-usage-one-caption-source.md. */}
          <ul className="space-y-1">
            {agents.map((agent) => {
              const active = isActive?.(agent.key) ?? false;
              return (
                <li key={agent.key}>
                  <button
                    type="button"
                    disabled={!onSelectAgent}
                    onClick={() => onSelectAgent?.(agent.key)}
                    aria-pressed={isActive ? active : undefined}
                    className={cn(
                      "flex w-full items-start justify-between gap-2 rounded-md px-2 py-1 text-left text-xs",
                      onSelectAgent && "cursor-pointer hover:bg-state-hover",
                      active && "bg-state-active",
                    )}
                  >
                    <span className="min-w-0">
                      <span className={cn("block truncate", active ? "text-foreground" : "text-foreground/90")} title={agent.name}>
                        {agent.name}
                      </span>
                      {agent.caption && (
                        <span className="block truncate text-subtle-foreground" title={agent.caption}>
                          {agent.caption}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatTokenCount(agent.total)} · {formatPrice(agent.cost, agent.unpricedModels)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
