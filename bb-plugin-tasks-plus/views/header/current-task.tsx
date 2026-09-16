import { useCallback, useEffect, useRef, useState } from "react";
import type { PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Task } from "../../shared/contract.js";
import { useInvalidation, useTasksRpc } from "../../client/data.js";
import { CallerThreadProvider } from "../../client/caller-thread.js";
import { PANEL_PATH, tasksRouteToSubPath } from "../../client/routes.js";
import { STATUS_LABELS } from "../../components/task-meta.js";
import { StatusIcon } from "../list/icons.js";

// Matches the native thread-header buttons rather than the plugin default
// (see memory/bb-header-button-style-tokens): outline/sm gives h-8/border-input,
// so the height and border are overridden here. A slug key can be long, so the
// chip is capped at 160px and its label truncates instead of spilling over
// the neighbouring header buttons.
const HEADER_ACTION_CLASS =
  "h-7 max-w-[160px] border-border/70 bg-transparent px-2 font-normal hover:bg-state-hover";

function taskDetailSubPath(taskKey: string): string {
  return tasksRouteToSubPath({ kind: "task", taskKey });
}

/**
 * The tasks this thread is attached to, kept fresh on attach/detach
 * (threads:changed) and task edits like a status change (tasks:changed).
 * `null` until the first load resolves, so the header shows nothing rather
 * than flashing a chip that then disappears. An RPC failure collapses to the
 * empty state — the header is a non-critical accessory and stays quiet.
 */
function useThreadTasks(threadId: string): Task[] | null {
  const rpc = useTasksRpc();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const seqRef = useRef(0);
  const refresh = useCallback(() => {
    const seq = ++seqRef.current;
    rpc.call("tasksForThread", { threadId }).then(
      (result) => {
        if (seq === seqRef.current) setTasks(result.tasks);
      },
      () => {
        if (seq === seqRef.current) setTasks([]);
      },
    );
  }, [rpc, threadId]);
  useEffect(() => {
    setTasks(null);
    refresh();
  }, [refresh]);
  useInvalidation(["threads:changed", "tasks:changed"], refresh);
  return tasks;
}

function statusLabel(task: Task): string {
  return STATUS_LABELS[task.status].toLowerCase();
}

/**
 * Thread-header chip naming the task(s) this thread solves. One task → a
 * single chip that opens it; several → a count that opens a picker. The same
 * link an agent reads through `bb tasks current`, surfaced for a human.
 */
export function CurrentTaskHeaderAction(props: PluginThreadHeaderActionProps) {
  // Кнопка принадлежит треду и спрашивает о задачах его рабочего дерева —
  // задача ветки на доске ещё не видна (client/caller-thread.tsx).
  return (
    <CallerThreadProvider threadId={props.threadId}>
      <CurrentTaskHeaderActionContent {...props} />
    </CallerThreadProvider>
  );
}

function CurrentTaskHeaderActionContent({
  threadId,
  isCompactViewport,
}: PluginThreadHeaderActionProps) {
  const navigate = useBbNavigate();
  const tasks = useThreadTasks(threadId);

  const openTask = useCallback(
    (task: Task) => {
      const opened = navigate.openThreadPanel({
        actionId: "task",
        title: task.key,
        params: { taskKey: task.key },
      });
      if (!opened) {
        navigate.toPluginPanel(PANEL_PATH, {
          subPath: taskDetailSubPath(task.key),
        });
      }
    },
    [navigate],
  );

  if (tasks === null || tasks.length === 0) return null;

  if (tasks.length === 1) {
    const task = tasks[0];
    if (!task) return null;
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Task ${task.key} — ${task.title} (${statusLabel(task)}) — open`}
        title={task.key}
        className={cn(HEADER_ACTION_CLASS, "gap-1.5")}
        onClick={() => openTask(task)}
      >
        <StatusIcon status={task.status} />
        {!isCompactViewport && (
          <span className="min-w-0 truncate font-mono text-xs">{task.key}</span>
        )}
      </Button>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`${tasks.length} tasks attached to this thread — open list`}
          className={cn(HEADER_ACTION_CLASS, "gap-1.5")}
        >
          <Icon name="ListTodo" className="size-3.5" aria-hidden="true" />
          {!isCompactViewport && (
            <span className="min-w-0 truncate text-xs">
              {tasks.length} tasks
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[54rem] max-w-[calc(100vw-2rem)] p-1"
      >
        <ul className="space-y-0.5">
          {tasks.map((task) => (
            <li key={task.id}>
              <button
                type="button"
                className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-label={`Task ${task.key} — ${task.title} — open`}
                onClick={() => openTask(task)}
              >
                <span aria-hidden>
                  <StatusIcon status={task.status} />
                </span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {task.key}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {task.title}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
