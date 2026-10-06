// Задача Tasks+ в окне Демонстрации — копия карточки директивы `::task` из Tasks+ (views/embed/index.tsx): строка со
// значком статуса, ключом, заголовком и приоритетом. Своя, потому что Markdown для плагинов чужих директив не рисует.
// Клик открывает задачу во вкладке Flow сбоку: SDK даёт плагину открыть только свою вкладку панели треда.
import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown, useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk";

import { isTaskAddress, readTaskLookup, taskLookupRequest, type TaskLookup, type TaskPriority, type TaskStatus } from "../core/task-lookup";
import { Button } from "../components/ui/button";
import { Icon } from "../components/ui/icon";
import { Skeleton } from "../components/ui/skeleton";
import { cn } from "../lib/utils";
import { useMessages } from "./locale-context";

/** Вкладка задачи в панели треда — id действия Flow. */
export const TASK_PANEL_ACTION = "task";

/** Задача у Tasks+ по ключу и треду брифа; повтор — заново. */
function useTaskLookup(taskKey: string, threadId: string): { state: TaskLookup; retry: () => void } {
  const [state, setState] = useState<TaskLookup>({ kind: "loading" });
  const seq = useRef(0);
  const load = useCallback(() => {
    const mine = ++seq.current;
    setState({ kind: "loading" });
    const { url, body } = taskLookupRequest(taskKey, threadId);
    fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body })
      .then(async (response) => readTaskLookup(response.status, await response.json().catch(() => null)))
      .catch((): TaskLookup => ({ kind: "error" }))
      .then((next) => {
        if (mine === seq.current) setState(next);
      });
  }, [taskKey, threadId]);
  useEffect(load, [load]);
  return { state, retry: load };
}

const STATUS_COLOR_CLASS: Record<TaskStatus, string> = {
  backlog: "text-subtle-foreground",
  todo: "text-subtle-foreground",
  in_progress: "text-attention",
  in_review: "text-timeline-accent",
  done: "text-success",
  canceled: "text-subtle-foreground",
};

/** Значок статуса Tasks+ (views/common/icons.tsx). */
function StatusIcon({ status }: { status: TaskStatus }) {
  const ring = (dashed: boolean) => (
    <circle cx="7" cy="7" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.6" {...(dashed ? { strokeDasharray: "1.8 2" } : {})} />
  );
  const disc = <circle cx="7" cy="7" r="6" fill="currentColor" />;
  return (
    <svg viewBox="0 0 14 14" aria-hidden data-task-status={status} className={cn("size-3.5 shrink-0", STATUS_COLOR_CLASS[status])}>
      {status === "backlog" && ring(true)}
      {status === "todo" && ring(false)}
      {status === "in_progress" && (
        <>
          {ring(false)}
          <path d="M7 7 L7 2.4 A4.6 4.6 0 0 1 11.2 9.5 Z" fill="currentColor" />
        </>
      )}
      {status === "in_review" && (
        <>
          {ring(false)}
          <path d="M7 7 L7 2.4 A4.6 4.6 0 1 1 6.99 2.4 Z" fill="currentColor" />
        </>
      )}
      {status === "done" && (
        <>
          {disc}
          <path d="M4.4 7.2 l1.8 1.8 3.4-3.8" fill="none" stroke="var(--background)" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
      {status === "canceled" && (
        <>
          {disc}
          <path d="M5 5 l4 4 M9 5 l-4 4" stroke="var(--background)" strokeWidth="1.4" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

const ACTIVE_BARS: Record<Exclude<TaskPriority, "urgent">, number> = { none: 0, low: 1, medium: 2, high: 3 };
const BARS = [
  { x: 1.5, y: 8, height: 5 },
  { x: 5.5, y: 5, height: 8 },
  { x: 9.5, y: 2, height: 11 },
];

/** Значок приоритета Tasks+ (views/common/icons.tsx). */
function PriorityIcon({ priority }: { priority: TaskPriority }) {
  if (priority === "urgent") {
    return (
      <svg viewBox="0 0 14 14" aria-hidden className="size-3.5 shrink-0 text-warning">
        <rect x="0.5" y="0.5" width="13" height="13" rx="3" fill="currentColor" />
        <rect x="6.2" y="3" width="1.6" height="5.2" rx="0.8" fill="var(--background)" />
        <circle cx="7" cy="10.6" r="1" fill="var(--background)" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 14 14" aria-hidden className={cn("size-3.5 shrink-0", priority === "none" && "opacity-40")}>
      {BARS.map((bar, index) => (
        <rect key={bar.x} x={bar.x} y={bar.y} width="3" height={bar.height} rx="1" className={index < ACTIVE_BARS[priority] ? "fill-muted-foreground" : "fill-muted"} />
      ))}
    </svg>
  );
}

function CardShell({ dashed = false, children }: { dashed?: boolean; children: React.ReactNode }) {
  return (
    <div
      data-task-card
      className={
        dashed
          ? "flex h-11 items-center gap-1 rounded-lg border border-dashed border-border bg-surface-recessed-solid px-2"
          : "flex h-11 items-center gap-1 rounded-lg border border-border bg-card px-2 shadow-sm transition-colors hover:bg-state-hover"
      }
    >
      {children}
    </div>
  );
}

const Key = ({ text }: { text: string }) => <span className="shrink-0 font-mono text-xs text-muted-foreground">{text}</span>;

/** Карточка задачи в окне Демонстрации; задача ищется в рабочем дереве треда брифа. */
export function TaskCard({ taskKey, threadId }: { taskKey: string; threadId: string }) {
  const t = useMessages().outcome;
  const navigate = useBbNavigate();
  const { state, retry } = useTaskLookup(taskKey, threadId);
  if (state.kind === "loading") {
    return (
      <CardShell>
        <div role="status" aria-label={t.taskLoading(taskKey)} className="flex min-w-0 flex-1 items-center gap-2 px-1">
          <Skeleton className="size-3.5 shrink-0 rounded-full" />
          <Key text={taskKey} />
          <Skeleton className="h-3.5 w-1/2" />
        </div>
      </CardShell>
    );
  }
  if (state.kind !== "found") {
    return (
      <CardShell dashed>
        <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
          {state.kind === "not_found" ? <StatusIcon status="backlog" /> : <Icon name="AlertCircle" className="size-3.5 shrink-0 text-muted-foreground" />}
          <Key text={taskKey} />
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{state.kind === "not_found" ? t.taskNotFound : t.taskError}</span>
        </div>
        {state.kind === "error" && (
          <Button variant="ghost" size="sm" className="shrink-0" onClick={retry}>
            {t.taskRetry}
          </Button>
        )}
      </CardShell>
    );
  }
  const { task } = state;
  return (
    <CardShell>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-label={t.taskOpen(task.key, task.title)}
        onClick={() => navigate.openThreadPanel({ actionId: TASK_PANEL_ACTION, title: task.key, params: { taskKey: task.key, threadId } })}
      >
        <StatusIcon status={task.status} />
        <Key text={task.key} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</span>
        {task.priority !== "none" && <PriorityIcon priority={task.priority} />}
      </button>
    </CardShell>
  );
}

const readPanelParams = (params: PluginThreadPanelProps["params"], fallbackThreadId: string): { taskKey: string; threadId: string } | null => {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  const { taskKey, threadId } = params;
  if (typeof taskKey !== "string" || !isTaskAddress(taskKey)) return null;
  return { taskKey: taskKey.trim(), threadId: typeof threadId === "string" && threadId !== "" ? threadId : fallbackThreadId };
};

/** Вкладка задачи сбоку: задача на чтение — статус, ключ, приоритет, заголовок, описание. Править — в Tasks+. */
export function TaskPanel({ params, threadId }: PluginThreadPanelProps) {
  const t = useMessages().outcome;
  const target = readPanelParams(params, threadId);
  if (target === null) return <div className="p-3 text-sm text-muted-foreground">{t.taskPanelHint}</div>;
  return <TaskPanelBody key={`${target.threadId}:${target.taskKey}`} {...target} />;
}

function TaskPanelBody({ taskKey, threadId }: { taskKey: string; threadId: string }) {
  const t = useMessages().outcome;
  const { state, retry } = useTaskLookup(taskKey, threadId);
  if (state.kind === "loading") {
    return (
      <div role="status" aria-label={t.taskLoading(taskKey)} className="flex flex-col gap-3 p-1">
        <Key text={taskKey} />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (state.kind !== "found") {
    return (
      <div className="flex flex-col items-start gap-2 p-1 text-sm text-muted-foreground">
        <Key text={taskKey} />
        {state.kind === "not_found" ? t.taskNotFound : t.taskError}
        {state.kind === "error" && (
          <Button variant="ghost" size="sm" onClick={retry}>
            {t.taskRetry}
          </Button>
        )}
      </div>
    );
  }
  const { task } = state;
  return (
    <article className="flex flex-col gap-3 p-1">
      <div className="flex items-center gap-2">
        <StatusIcon status={task.status} />
        <Key text={task.key} />
        {task.priority !== "none" && <PriorityIcon priority={task.priority} />}
      </div>
      <h2 className="m-0 text-base font-semibold leading-snug">{task.title}</h2>
      {task.description.trim() !== "" && <Markdown content={task.description} />}
    </article>
  );
}
