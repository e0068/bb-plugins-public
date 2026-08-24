// bb-plugin-token-usage-header — frontend entry.
//
// One thread-header control: a compact button showing the session's total
// token spend, with a popover for the full breakdown. Mounted once per
// visible thread (twice in a split view) — all state lives in the
// component, never at module scope.
import { useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  useRpc,
  type PluginRpcResult,
  type PluginThreadHeaderActionProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatCost, formatPercent, formatTokenCount } from "./src/core";

type SessionTokenUsage = PluginRpcResult<(typeof rpcContract)["sessionTokenUsage"]>;
type ReadyUsage = Extract<SessionTokenUsage, { status: "ready" }>;

type LoadState =
  | { kind: "loading" }
  | { kind: "no-session" }
  | { kind: "error"; message: string }
  | { kind: "ready"; usage: ReadyUsage };

/**
 * The four phases of one model call, in display order: the three parts of
 * input fed in together (what was already cached and re-read, what was
 * newly cached, what was neither), then the generated output. `thinking`
 * isn't a phase of its own — it's already counted inside `output_tokens`,
 * so it's rendered as a nested line under the output row instead of
 * appearing here (see the nested row in UsageDetails below).
 */
const TOKEN_PHASES: ReadonlyArray<{
  key: "cacheRead" | "cacheWrite" | "input" | "output";
  label: string;
}> = [
  { key: "cacheRead", label: "Чтение кэша" },
  { key: "cacheWrite", label: "Запись в кэш" },
  { key: "input", label: "Вход" },
  { key: "output", label: "Выход" },
];

function TokenUsageHeaderAction({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [open, setOpen] = useState(false);

  // Guards two ways a response can arrive after it stops mattering: a
  // slower earlier request (mount) resolving after a faster later one
  // (popover open) — only the response matching the current generation is
  // applied — and any response arriving after unmount, which `mountedRef`
  // catches regardless of generation.
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function load() {
    const requestId = ++requestIdRef.current;
    setState({ kind: "loading" });
    rpc.call("sessionTokenUsage", { threadId }).then(
      (result) => {
        if (!mountedRef.current || requestIdRef.current !== requestId) return;
        if (result.status === "ready") setState({ kind: "ready", usage: result });
        else if (result.status === "no-session") setState({ kind: "no-session" });
        else setState({ kind: "error", message: result.message });
      },
      (err: unknown) => {
        if (!mountedRef.current || requestIdRef.current !== requestId) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Не удалось получить данные о токенах.",
        });
      },
    );
  }

  // Fetch once per mounted thread; re-fetching happens on popover open, not
  // on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [threadId]);

  const isError = state.kind === "error";
  const buttonText =
    state.kind === "ready"
      ? `${formatTokenCount(state.usage.totals.total)} · ${formatCost(state.usage.totals.cost)}`
      : state.kind === "no-session"
        ? "–"
        : state.kind === "loading"
          ? "…"
          : "";
  const ariaLabel =
    state.kind === "ready"
      ? `Расход токенов Claude Code: ${formatTokenCount(state.usage.totals.total)}, ${formatCost(state.usage.totals.cost)}`
      : state.kind === "no-session"
        ? "Расход токенов Claude Code: сессия ещё не начата"
        : state.kind === "loading"
          ? "Расход токенов Claude Code: загрузка"
          : `Расход токенов Claude Code: ошибка — ${state.message}`;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) load();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={ariaLabel}
          className="h-7 gap-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground data-[state=open]:text-foreground"
        >
          <Icon name={isError ? "AlertCircle" : "ChartColumn"} className={cn("size-3.5", isError && "text-destructive")} aria-hidden="true" />
          {/* The SDK's contract for isCompactViewport: "Collapse to an
              icon-sized control when it is true — the row is short." The
              number stays available via aria-label. */}
          {buttonText && !isCompactViewport && <span className={cn(isError && "text-destructive")}>{buttonText}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3">
        {state.kind === "loading" && <p className="text-sm text-muted-foreground">Загрузка…</p>}
        {state.kind === "no-session" && (
          <p className="text-sm text-muted-foreground">
            Сессия ещё не началась — счётчик появится после первого ответа.
          </p>
        )}
        {state.kind === "error" && <p className="text-sm text-destructive">{state.message}</p>}
        {state.kind === "ready" && <UsageDetails usage={state.usage} />}
      </PopoverContent>
    </Popover>
  );
}

function UsageDetails({ usage }: { usage: ReadyUsage }) {
  const { totals, agents } = usage;
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-foreground">Всего токенов</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">{formatTokenCount(totals.total)}</span>
      </div>

      <dl className="space-y-1">
        {TOKEN_PHASES.map(({ key, label }) => {
          const value = totals[key];
          return (
            <div key={key} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <dt>{label}</dt>
              <dd className="tabular-nums">
                {formatTokenCount(value)}{" "}
                <span className="text-muted-foreground/70">({formatPercent(value, totals.total)})</span>{" "}
                · {formatCost(totals.costs[key])}
              </dd>
            </div>
          );
        })}
        {/* Thinking is part of the output, not a fifth phase — nested under
            the output row above, its share is of `totals.output` (the
            share of `totals.total` would always read "0%"). */}
        <div className="flex items-center justify-between gap-2 pl-3 text-xs text-muted-foreground/70">
          <dt>в т.ч. размышления</dt>
          <dd className="tabular-nums">
            {formatTokenCount(totals.thinking)}{" "}
            <span className="text-muted-foreground/50">({formatPercent(totals.thinking, totals.output)})</span>{" "}
            · {formatCost(totals.costs.thinking)}
          </dd>
        </div>
      </dl>

      <div className="flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
        <span>Стоимость</span>
        <span className="font-medium tabular-nums text-foreground">{formatCost(totals.cost)}</span>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Ответов</span>
        <span className="font-medium tabular-nums text-foreground">{totals.messages}</span>
      </div>

      {agents.length > 0 && (
        <div className="space-y-1 border-t border-border pt-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-muted-foreground">Агенты</span>
            {usage.truncated && (
              <span className="text-xs text-muted-foreground/70">показаны не все</span>
            )}
          </div>
          <ul className="space-y-1">
            {/* Имя и подпись не собирать заново — они уже готовы с сервера
                (formatBucketDisplay), см. memory/decisions/token-usage-one-caption-source.md. */}
            {agents.map((agent) => (
              <li key={agent.key} className="flex items-start justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <div className="truncate text-foreground" title={agent.name}>
                    {agent.name}
                  </div>
                  {agent.caption && <div className="truncate text-muted-foreground/70">{agent.caption}</div>}
                </div>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatTokenCount(agent.total)} · {formatCost(agent.cost)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "token-usage-header",
    title: "Расход токенов",
    component: TokenUsageHeaderAction,
  });
});
