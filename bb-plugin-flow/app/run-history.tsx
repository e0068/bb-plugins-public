// История прогонов — вкладка страницы Flow: все завершённые прогоны всех
// тредов, свежие сверху. Строка — тред, flow, окно, минуты, деньги и этапы;
// раскрытая — тот же итог, что под карточкой брифа в ленте треда
// (`RunSummaryBody`). Итоги заморожены и больше не меняются, поэтому список
// читается одним запросом при открытии вкладки и не опрашивается.
import { useEffect, useRef, useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";

import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import type { progressRpcContract, RunHistoryEntry } from "../shared/contract";
import { useMessages } from "./locale-context";
import { money } from "./progress-banner";
import { RunSummaryBody, runWindow } from "./run-summary";

/** Адрес вкладки истории в `subPath` панели Flow; id flow так не называются — у них префикс `flow-`. */
export const HISTORY_SUB_PATH = "history";

type Loaded = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; runs: RunHistoryEntry[] };

function useRunHistory(): Loaded {
  const rpc = useRpc<typeof progressRpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [state, setState] = useState<Loaded>({ kind: "loading" });
  useEffect(() => {
    let alive = true;
    rpcRef.current.call("getRunHistory", {}).then(
      (runs) => alive && setState({ kind: "ready", runs }),
      () => alive && setState({ kind: "failed" }),
    );
    return () => {
      alive = false;
    };
    // Итоги заморожены: один запрос на открытие вкладки.
  }, []);
  return state;
}

function HistoryRow({ run }: { run: RunHistoryEntry }) {
  const t = useMessages();
  const navigate = useBbNavigate();
  const [open, setOpen] = useState(false);
  const title = run.exists ? (run.title ?? t.history.untitled) : t.history.gone;
  const summary = run.summary;
  return (
    <div data-run-history-row className="flex flex-col rounded-lg bg-surface-recessed-solid">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 text-sm">
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? t.history.collapse(title) : t.history.expand(title)}
          onClick={() => setOpen((value) => !value)}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
        >
          <Icon name="ChevronDown" aria-hidden="true" className={cn("size-3.5", !open && "-rotate-90")} />
        </button>
        {run.exists ? (
          <button type="button" onClick={() => navigate.toThread(run.threadId)} className="min-w-0 truncate font-medium hover:underline">
            {title}
          </button>
        ) : (
          <span className="min-w-0 truncate text-muted-foreground">{title}</span>
        )}
        {run.flowName !== undefined && <span className="truncate text-muted-foreground">{run.flowName}</span>}
        <span className="ml-auto flex shrink-0 gap-2 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          <span>{runWindow(t, summary)}</span>
          <span>{t.summary.hours(Math.floor(summary.minutes / 60), summary.minutes % 60)}</span>
          <span>{money(summary.cost)}</span>
          <span>{t.progress.count(run.done, run.total)}</span>
        </span>
      </div>
      {open && (
        <div className="px-2 pb-2">
          <RunSummaryBody view={run} />
        </div>
      )}
    </div>
  );
}

export function RunHistory() {
  const t = useMessages();
  const state = useRunHistory();
  return (
    <div className="flex h-full min-h-0 flex-col p-6">
      <section aria-label={t.history.label} aria-busy={state.kind === "loading"} className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto">
        {state.kind === "failed" && <p className="text-sm text-muted-foreground">{t.history.failed}</p>}
        {state.kind === "ready" && state.runs.length === 0 && <p className="text-sm text-muted-foreground">{t.history.empty}</p>}
        {state.kind === "ready" && state.runs.map((run) => <HistoryRow key={run.briefId} run={run} />)}
      </section>
    </div>
  );
}
