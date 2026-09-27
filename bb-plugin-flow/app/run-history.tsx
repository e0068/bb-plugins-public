// История прогонов — вкладка страницы Flow: все завершённые прогоны всех
// тредов. Над карточками — шапка колонок, липкая к прокрутке всей страницы,
// клик по заголовку сортирует; строки карточек делят с шапкой одну сетку,
// поэтому цифры стоят под своей колонкой. Раскрытая карточка — тот же итог,
// что под брифом в ленте треда (`RunSummaryBody`), только этапы видны сразу и
// целиком. Итоги заморожены и больше не меняются, поэтому список читается
// одним запросом при открытии вкладки.
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";

import { historyMoment } from "../core/history-moment";
import { DEFAULT_HISTORY_SORT, HISTORY_COLUMNS, nextHistorySort, sortHistory, type HistoryColumn, type HistorySort } from "../core/run-history";
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import type { progressRpcContract, RunHistoryEntry } from "../shared/contract";
import { useMessages } from "./locale-context";
import { FLOWS_PANEL_PATH } from "./panel-path";
import { money } from "./progress-banner";
import { RunSummaryBody } from "./run-summary";

/** Адрес вкладки истории в `subPath` панели Flow; id flow так не называются — у них префикс `flow-`. */
export const HISTORY_SUB_PATH = "history";

type Loaded = { kind: "loading" } | { kind: "failed" } | { kind: "ready"; runs: RunHistoryEntry[] };
type Messages = ReturnType<typeof useMessages>;

/**
 * Сетка колонок, общая у шапки и строк. Узкая панель: шеврон, название, flow,
 * а проект, время и деньги — второй линией; с 52rem — таблица, значения в своих
 * колонках. Проект в разметке стоит во второй линии, поэтому в таблицу его и
 * flow ставит `order`: шапка идёт в порядке `HISTORY_COLUMNS`.
 */
const WIDE_COLUMNS = "@[52rem]:grid-cols-[24px_minmax(0,1fr)_112px_76px_104px_104px_72px_64px]";
const ROW_GRID = "grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-3";

const NUMERIC: ReadonlySet<HistoryColumn> = new Set(["minutes", "cost"]);

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

/** Подпись треда так, как её видит владелец: по ней же сортируется колонка «Тред». */
const titleOf = (t: Messages, run: RunHistoryEntry): string => (run.exists ? (run.title ?? t.history.untitled) : t.history.gone);

/** Выделение текста мышью — не клик по карточке; клавиатурный клик (`detail` 0) выделением не блокируется. */
const selectingText = (event: MouseEvent): boolean => event.detail > 0 && (window.getSelection()?.toString() ?? "") !== "";

function SortHeader({ sort, onSort }: { sort: HistorySort; onSort: (column: HistoryColumn) => void }) {
  const t = useMessages();
  return (
    <div
      role="group"
      aria-label={t.history.sort}
      className={cn(
        "sticky top-0 z-10 flex flex-wrap gap-x-2.5 bg-background px-2 pb-1 pt-2 text-xs text-muted-foreground",
        "@[52rem]:grid @[52rem]:h-8 @[52rem]:items-center @[52rem]:gap-x-3 @[52rem]:py-0 @[52rem]:pr-3",
        WIDE_COLUMNS,
      )}
    >
      <span aria-hidden="true" className="hidden @[52rem]:block" />
      {HISTORY_COLUMNS.map((column) => {
        const active = sort.column === column;
        const shown = active ? sort : nextHistorySort(sort, column);
        const label = t.history.columns[column];
        const arrow = <Icon name={shown.direction === "asc" ? "ArrowUp" : "ArrowDown"} aria-hidden="true" className={cn("size-3", !active && "opacity-0 group-hover/th:opacity-100")} />;
        return (
          <button
            key={column}
            type="button"
            aria-pressed={active}
            aria-label={active ? t.history.sorted(label, sort.direction === "asc") : undefined}
            onClick={() => onSort(column)}
            className={cn(
              "group/th -mx-1 flex h-6 items-center gap-1 whitespace-nowrap rounded-md px-1 hover:bg-state-hover hover:text-foreground",
              active && "text-foreground",
              NUMERIC.has(column) && "@[52rem]:justify-self-end",
            )}
          >
            {NUMERIC.has(column) && arrow}
            {label}
            {!NUMERIC.has(column) && arrow}
          </button>
        );
      })}
    </div>
  );
}

function HistoryRow({ run, now }: { run: RunHistoryEntry; now: Date }) {
  const t = useMessages();
  const navigate = useBbNavigate();
  const [open, setOpen] = useState(false);
  const title = titleOf(t, run);
  const summary = run.summary;
  const toggle = (event: MouseEvent) => {
    if (!selectingText(event)) setOpen((value) => !value);
  };
  return (
    <div data-run-history-row className={cn("flex flex-col rounded-lg bg-surface-recessed-solid", !open && "hover:bg-state-hover")}>
      <div onClick={toggle} className={cn(ROW_GRID, WIDE_COLUMNS, "min-h-10 cursor-pointer gap-y-0.5 py-1.5 pl-2 pr-3 text-sm", open && "rounded-t-lg hover:bg-state-hover")}>
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? t.history.collapse(title) : t.history.expand(title)}
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
        >
          <Icon name="ChevronDown" aria-hidden="true" className={cn("size-3.5", !open && "-rotate-90")} />
        </button>
        <span data-history-cell="title" className="flex min-w-0">
          {run.exists ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                navigate.toThread(run.threadId);
              }}
              className="min-w-0 truncate text-left font-medium hover:underline"
            >
              {title}
            </button>
          ) : (
            <span className="min-w-0 truncate text-muted-foreground">{title}</span>
          )}
        </span>
        <span data-history-cell="flow" className="flex min-w-0 text-xs text-muted-foreground @[52rem]:order-2">
          {run.flowId === undefined ? (
            <span className="truncate">{run.flowName ?? ""}</span>
          ) : (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                navigate.toPluginPanel(FLOWS_PANEL_PATH, { subPath: run.flowId });
              }}
              className="min-w-0 truncate text-left hover:text-foreground hover:underline"
            >
              {run.flowName ?? run.flowId}
            </button>
          )}
        </span>
        <span className="col-span-2 col-start-2 flex flex-wrap gap-x-2.5 whitespace-nowrap text-xs tabular-nums text-muted-foreground @[52rem]:contents">
          <span data-history-cell="project" className="min-w-0 truncate empty:hidden @[52rem]:order-1 @[52rem]:empty:block">
            {run.project ?? ""}
          </span>
          <span data-history-cell="started" className="truncate @[52rem]:order-3">
            {historyMoment(summary.startedAt, now)}
          </span>
          <span data-history-cell="finished" className="truncate @[52rem]:order-3">
            {historyMoment(summary.finishedAt, now)}
          </span>
          <span data-history-cell="minutes" className="@[52rem]:order-3 @[52rem]:text-right">
            {t.summary.hours(Math.floor(summary.minutes / 60), summary.minutes % 60)}
          </span>
          <span data-history-cell="cost" className="@[52rem]:order-3 @[52rem]:text-right">
            {money(summary.cost)}
          </span>
        </span>
      </div>
      {open && (
        <div className="px-3 pb-3 pt-0.5 @[52rem]:pl-11">
          <RunSummaryBody view={run} stagesOpen />
        </div>
      )}
    </div>
  );
}

export function RunHistory() {
  const t = useMessages();
  const state = useRunHistory();
  const [sort, setSort] = useState<HistorySort>(DEFAULT_HISTORY_SORT);
  // «Сегодня» для колонок времени — момент открытия вкладки: список читается тем же разом.
  const [now] = useState(() => new Date());
  return (
    <section aria-label={t.history.label} aria-busy={state.kind === "loading"} className="@container flex flex-col gap-1.5">
      {state.kind === "failed" && <p className="text-sm text-muted-foreground">{t.history.failed}</p>}
      {state.kind === "ready" && state.runs.length === 0 && <p className="text-sm text-muted-foreground">{t.history.empty}</p>}
      {state.kind === "ready" && state.runs.length > 0 && (
        <>
          <SortHeader sort={sort} onSort={(column) => setSort((current) => nextHistorySort(current, column))} />
          {sortHistory(state.runs, sort, (run) => titleOf(t, run)).map((run) => (
            <HistoryRow key={run.briefId} run={run} now={now} />
          ))}
        </>
      )}
    </section>
  );
}
