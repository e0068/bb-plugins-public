// Итог завершённого прогона в ленте треда. Хост не даёт слота «вставить блок
// в ленту», поэтому блок растёт из карточки директивы, которая в ленте уже
// стоит: сервер называет бриф, под которым итог должен встать, и рисует его
// только эта карточка. Полоса и строки этапов — те же, что у баннера над
// композером: это один и тот же прогресс-бар, просто отцепленный от композера.
import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";

import { mutedBlinkKeyframes } from "../core/muted-blink";
import { stageLabel } from "../core/stages";
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import type { FrozenRun, ProgressStage, RunSummaryView, progressRpcContract } from "../shared/contract";
import { AutomationSteps, Row, money, useOpenResult } from "./progress-banner";
import { useMessages } from "./locale-context";

const POLL_MS = 5000;

/** Час и минуты словами: «2 ч 6 м», «54 м». */
const spanOf = (t: ReturnType<typeof useMessages>, minutes: number): string => t.summary.hours(Math.floor(minutes / 60), minutes % 60);

/** Время окна прогона в часах и минутах местной зоны. */
const clock = (iso: string, locale: string): string => new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

const day = (iso: string, locale: string): string => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long" });

function Tile({ title, value, under, children }: { title: string; value: string; under?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 bg-surface-recessed-solid px-3 py-2.5">
      <span className="text-[11px] text-muted-foreground">{title}</span>
      <b className="text-[17px] font-semibold tabular-nums">{value}</b>
      {under !== undefined && <span className="text-[11px] tabular-nums text-muted-foreground">{under}</span>}
      {children}
    </div>
  );
}

/** Плитки итога: кто вёл прогон, сколько он работал, во что обошёлся и сколько ждал владельца. */
function Tiles({ summary, planned, open, toggle }: { summary: RunSummaryView; planned: FrozenRun["planned"]; open: boolean; toggle: () => void }) {
  const t = useMessages();
  const agents = summary.executors.filter((e) => e.kind !== "workflow").length;
  const workflows = summary.executors.length - agents;
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg @[34rem]:grid-cols-4">
      <Tile title={t.summary.executors} value={String(summary.executors.length)} under={t.summary.agents(agents, workflows)}>
        <button type="button" onClick={toggle} className="flex items-center gap-1 self-start text-[11px] text-muted-foreground hover:text-foreground">
          <Icon name="ChevronDown" aria-hidden="true" className={cn("size-3", open && "rotate-180")} />
          {open ? t.summary.hide : t.summary.who}
        </button>
      </Tile>
      <Tile title={t.summary.work} value={spanOf(t, summary.minutes)} under={planned?.minutes == null ? t.summary.noPlan : t.summary.plan(spanOf(t, planned.minutes))} />
      <Tile title={t.summary.spend} value={money(summary.cost)} under={planned == null ? t.summary.noPlan : t.summary.plan(`${money(planned.target)}–${money(planned.max).slice(1)}`)} />
      <Tile title={t.summary.idle} value={spanOf(t, summary.idleMinutes)} under={t.summary.stages(summary.stages)} />
    </div>
  );
}

function Executors({ summary }: { summary: RunSummaryView }) {
  return (
    <div className="flex flex-col gap-px overflow-hidden rounded-lg">
      {summary.executors.map((executor) => (
        <div key={executor.id} data-run-executor className="flex items-center justify-between gap-3 bg-surface-recessed-solid px-3 py-2 text-xs">
          <span className="flex min-w-0 items-center gap-2">
            <Icon name={executor.kind === "workflow" ? "Workflow" : executor.kind === "agent" ? "Bot" : "Diamond"} aria-hidden="true" className="size-3.5 text-muted-foreground" />
            <span className="truncate">{executor.model === undefined ? executor.name : `${executor.name} · ${executor.model}`}</span>
          </span>
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            {executor.stages} · {money(executor.cost)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Та же полоса, что над композером, но отцепленная: свёрнута по умолчанию и разворачивается в этапы прогона. */
function RunBar({ view, threadId }: { view: FrozenRun; threadId: string }) {
  const t = useMessages();
  const [open, setOpen] = useState(false);
  const openResult = useOpenResult(threadId, view.environmentId ?? null);
  const last = view.stages[view.stages.length - 1]!;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-recessed-solid text-xs">
      <style>{mutedBlinkKeyframes}</style>
      {open && (
        <div className="flex max-h-[50vh] flex-col gap-px overflow-y-auto pt-1">
          {view.stages.map((stage: ProgressStage) => (
            <div key={stage.id} className="flex flex-col">
              <Row stage={stage} open={openResult} />
              {stage.automation !== undefined && stage.state !== "todo" && stage.state !== "skip" && <AutomationSteps stage={stage} threadId={threadId} />}
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-label={t.progress.label(stageLabel(last, t.stages), view.done, view.total)}
        onClick={() => setOpen((value) => !value)}
        className="grid min-h-[34px] w-full grid-cols-[auto_16px_minmax(0,1fr)_auto_20px] items-center gap-2.5 px-3 py-1.5 text-left hover:bg-state-hover"
      >
        <span className="shrink-0 tabular-nums">{t.progress.count(view.done, view.total)}</span>
        <span className="flex justify-center">
          <Icon name="Flag" aria-hidden="true" className="size-3.5" />
        </span>
        <span aria-hidden="true" className="flex h-1 min-w-10 gap-0.5">
          {view.stages
            .filter((stage) => stage.state !== "skip")
            .map((stage) => (
              <i key={stage.id} data-progress-segment className="relative flex-1 rounded-sm bg-foreground" />
            ))}
        </span>
        <span className="flex justify-end gap-1.5 whitespace-nowrap tabular-nums text-muted-foreground">
          <span>{t.progress.minutes(view.summary.minutes)}</span>
          <span>{money(view.summary.cost)}</span>
        </span>
        <Icon name="ChevronDown" aria-hidden="true" className={cn("size-3.5 text-muted-foreground", open && "rotate-180")} />
      </button>
    </div>
  );
}

/**
 * Итог этого брифа: замороженная запись, а не текущий прогресс. Она не
 * меняется, поэтому опрашивать нечего — один запрос, и дальше блок живёт сам.
 * Пока прогон не завершился, ответ пустой, и блока нет.
 */
function useFrozenRun(briefId: string): FrozenRun | null {
  const rpc = useRpc<typeof progressRpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [run, setRun] = useState<FrozenRun | null>(null);
  useEffect(() => {
    // Найденный итог больше не меняется: опрос идёт, только пока прогон не закрылся.
    if (run !== null) return;
    let alive = true;
    const pull = () => rpcRef.current.call("getRunSummary", { briefId }).then((next) => alive && next !== null && setRun(next), () => undefined);
    void pull();
    const timer = setInterval(() => void pull(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [briefId, run]);
  return run;
}

/**
 * Итог прогона под карточкой брифа. Рисует его только та карточка, которую
 * назвал сервер: брифов у треда много, а итог у прогона один.
 */
export function RunSummaryBlock({ briefId }: { briefId: string }) {
  const t = useMessages();
  const view = useFrozenRun(briefId);
  if (view === null) return null;
  const summary = view.summary;
  return (
    <div data-run-summary role="group" aria-label={t.summary.label} className="@container my-3 flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-recessed-solid px-3 py-2 text-[13px]">
        <Icon name="Flag" aria-hidden="true" className="size-3.5" />
        <b className="font-semibold">{t.summary.finished}</b>
        {view.flowName !== undefined && <span className="text-muted-foreground">{view.flowName}</span>}
        <span className="ml-auto whitespace-nowrap tabular-nums text-[12px] text-muted-foreground">
          {runWindow(t, summary)}
        </span>
      </div>
      <RunSummaryBody view={view} />
    </div>
  );
}

/** День и окно прогона: «19 сентября, 10:00–13:00». */
export const runWindow = (t: ReturnType<typeof useMessages>, summary: RunSummaryView): string =>
  `${day(summary.startedAt, t.common.dateLocale)}, ${t.summary.window(clock(summary.startedAt, t.common.dateLocale), clock(summary.finishedAt, t.common.dateLocale))}`;

/** Тело итога — плитки, исполнители и полоса этапов: одно на ленту треда и на историю прогонов, чтобы два вида не разошлись. */
export function RunSummaryBody({ view }: { view: FrozenRun }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-run-summary-body className="@container flex flex-col gap-2 text-xs">
      <Tiles summary={view.summary} planned={view.planned} open={open} toggle={() => setOpen((value) => !value)} />
      {open && <Executors summary={view.summary} />}
      <RunBar view={view} threadId={view.threadId} />
    </div>
  );
}
