// Итог завершённого прогона в ленте треда. Хост не даёт слота «вставить блок
// в ленту», поэтому блок растёт из карточки директивы, которая в ленте уже
// стоит: сервер называет бриф, под которым итог должен встать, и рисует его
// только эта карточка. Полоса и строки этапов — те же, что у баннера над
// композером: это один и тот же прогресс-бар, просто отцепленный от композера.
import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";

import { mutedBlinkKeyframes } from "../core/muted-blink";
import { runTasks, type RunTask } from "../core/run-tasks";
import { stageLabel } from "../core/stages";
import { Icon } from "../components/ui/icon";
import { cn } from "../lib/utils";
import type { FileRoots } from "../core/result-link";
import type { FrozenRun, ProgressStage, RunSummaryView, progressRpcContract } from "../shared/contract";
import { ResultAnchor, TaskLink } from "./cells";
import { StageList, money, useRunRoots } from "./progress-banner";
import { summaryHeightKey, useHeldHeight } from "./held-height";
import { useMessages } from "./locale-context";

const POLL_MS = 5000;

/** Час и минуты словами: «2 ч 6 м», «54 м». */
const spanOf = (t: ReturnType<typeof useMessages>, minutes: number): string => t.summary.hours(Math.floor(minutes / 60), minutes % 60);

/** Время окна прогона в часах и минутах местной зоны. */
const clock = (iso: string, locale: string): string => new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

const day = (iso: string, locale: string): string => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long" });

function Tile({ title, value, lines = [], children }: { title: string; value?: string; lines?: readonly string[]; children?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-surface-recessed-solid px-3 py-2.5">
      <span className="text-[11px] text-muted-foreground">{title}</span>
      {value !== undefined && <b className="text-[17px] font-semibold tabular-nums">{value}</b>}
      {lines.map((line) => (
        <span key={line} className="text-[11px] tabular-nums text-muted-foreground">
          {line}
        </span>
      ))}
      {children}
    </div>
  );
}

/** Задачи прогона ссылками на их карточки в Tasks+: ключ и название, если этап его запомнил. */
function TaskLinks({ tasks }: { tasks: readonly RunTask[] }) {
  const t = useMessages();
  if (tasks.length === 0) return <span className="text-[11px] text-muted-foreground">{t.summary.noTasks}</span>;
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {tasks.map((task) => (
        <TaskLink key={task.address} address={task.address} className="flex min-w-0 items-baseline gap-1.5 text-[12px] hover:underline">
          <span className="shrink-0 font-mono text-muted-foreground">{task.address}</span>
          {task.title !== undefined && <span className="truncate">{task.title}</span>}
        </TaskLink>
      ))}
    </div>
  );
}

/** Файлы журнала прогона ссылками bb на дерево треда, подписанные именем файла. */
function JournalLinks({ journal, roots }: { journal: readonly string[]; roots: FileRoots | null }) {
  const t = useMessages();
  if (journal.length === 0) return <span className="text-[11px] text-muted-foreground">{t.summary.noJournal}</span>;
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {journal.map((path) => (
        <ResultAnchor key={path} target={path} roots={roots} className="min-w-0 truncate text-left text-[12px] hover:underline">
          {path.slice(path.lastIndexOf("/") + 1)}
        </ResultAnchor>
      ))}
    </div>
  );
}

/** Плитки итога: кто вёл прогон, сколько времени он занял, во что обошёлся, над какими задачами шёл и какой журнал оставил. */
function Tiles({ view, roots, open, toggle }: { view: FrozenRun; roots: FileRoots | null; open: boolean; toggle: () => void }) {
  const t = useMessages();
  const { summary, planned } = view;
  const agents = summary.executors.filter((e) => e.kind !== "workflow").length;
  const workflows = summary.executors.length - agents;
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg @[34rem]:grid-cols-4">
      <Tile title={t.summary.executors} value={String(summary.executors.length)} lines={[t.summary.agents(agents, workflows)]}>
        <button type="button" onClick={toggle} className="flex items-center gap-1 self-start text-[11px] text-muted-foreground hover:text-foreground">
          <Icon name="ChevronDown" aria-hidden="true" className={cn("size-3", open && "rotate-180")} />
          {open ? t.summary.hide : t.summary.who}
        </button>
      </Tile>
      <Tile
        title={t.summary.spent}
        value={spanOf(t, summary.minutes)}
        lines={[planned?.minutes == null ? t.summary.noPlan : t.summary.plan(spanOf(t, planned.minutes)), t.summary.idle(spanOf(t, summary.idleMinutes))]}
      />
      <Tile title={t.summary.spend} value={money(summary.cost)} lines={[planned == null ? t.summary.noPlan : t.summary.plan(`${money(planned.target)} – ${money(planned.max).slice(1)}`)]} />
      <Tile title={t.summary.tasks}>
        <TaskLinks tasks={runTasks(view.stages)} />
      </Tile>
      {view.journal !== undefined && (
        // Имена файлов журнала длинные: плитка идёт во всю ширину под остальными.
        <div className="col-span-full">
          <Tile title={t.summary.journal}>
            <JournalLinks journal={view.journal} roots={roots} />
          </Tile>
        </div>
      )}
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

/**
 * Та же полоса, что над композером, но отцепленная: свёрнута по умолчанию и разворачивается в этапы прогона.
 * В ленте треда этапы листаются в рамке в полэкрана, чтобы не растягивать ленту; в истории (`stagesOpen`)
 * страницу листает её корень, и этапы стоят целиком — вторая прокрутка внутри первой только мешала.
 */
function RunBar({ view, threadId, roots, stagesOpen }: { view: FrozenRun; threadId: string; roots: FileRoots | null; stagesOpen: boolean }) {
  const t = useMessages();
  const [open, setOpen] = useState(stagesOpen);
  const last = view.stages[view.stages.length - 1]!;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-recessed-solid text-xs">
      <style>{mutedBlinkKeyframes}</style>
      {open && (
        <div className={cn("flex flex-col gap-px pt-1", !stagesOpen && "max-h-[50vh] overflow-y-auto")}>
          <StageList stages={view.stages} roots={roots} threadId={threadId} />
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
 * Итог этого брифа: замороженная запись, а не текущий прогресс. Пока прогон не
 * завершился, ответ пустой, и блока нет; найденный итог больше не меняется, и
 * опрос на нём останавливается. `known` — первый ответ сервера пришёл: итог
 * есть, его нет или запрос не удался.
 */
function useFrozenRun(briefId: string): { run: FrozenRun | null; known: boolean } {
  const rpc = useRpc<typeof progressRpcContract>();
  const rpcRef = useRef(rpc);
  rpcRef.current = rpc;
  const [run, setRun] = useState<FrozenRun | null>(null);
  const [known, setKnown] = useState(false);
  useEffect(() => {
    // Найденный итог больше не меняется: опрос идёт, только пока прогон не закрылся.
    if (run !== null) return;
    let alive = true;
    const pull = () =>
      rpcRef.current.call("getRunSummary", { briefId }).then(
        (next) => {
          if (!alive) return;
          setKnown(true);
          if (next !== null) setRun(next);
        },
        () => alive && setKnown(true),
      );
    void pull();
    const timer = setInterval(() => void pull(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [briefId, run]);
  return { run, known };
}

/**
 * Итог прогона под карточкой брифа. Рисует его только та карточка, которую
 * назвал сервер: брифов у треда много, а итог у прогона один.
 */
export function RunSummaryBlock({ briefId }: { briefId: string }) {
  const { run, known } = useFrozenRun(briefId);
  const { held, frame } = useHeldHeight(summaryHeightKey(briefId), run !== null);
  // Пока сервер не ответил, итог прошлого показа держит место заглушкой с теми же полями — см. `held-height.tsx`.
  const placeholder = !known && held !== null ? <div data-run-summary-placeholder="" aria-hidden="true" className="my-3" style={{ minHeight: held }} /> : null;
  return (
    <div ref={frame} style={{ display: "contents" }}>
      {run === null ? placeholder : <RunSummary view={run} />}
    </div>
  );
}

function RunSummary({ view }: { view: FrozenRun }) {
  const t = useMessages();
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

/**
 * Тело итога — плитки, исполнители и полоса этапов: одно на ленту треда и на
 * историю прогонов, чтобы два вида не разошлись. В ленте полоса свёрнута, в
 * истории этапы видны сразу — `stagesOpen`.
 */
export function RunSummaryBody({ view, stagesOpen = false }: { view: FrozenRun; stagesOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  const roots = useRunRoots(view.threadId, view.environmentId ?? null);
  return (
    <div data-run-summary-body className="@container flex flex-col gap-2 text-xs">
      <Tiles view={view} roots={roots} open={open} toggle={() => setOpen((value) => !value)} />
      {open && <Executors summary={view.summary} />}
      <RunBar view={view} threadId={view.threadId} roots={roots} stagesOpen={stagesOpen} />
    </div>
  );
}
