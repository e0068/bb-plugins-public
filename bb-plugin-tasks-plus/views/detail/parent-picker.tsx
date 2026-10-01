import { useState } from "react";
import type { Task } from "../../shared/contract.js";
import { descendantsOf } from "../../shared/subtree.js";
import { listAllTasks, useTasksRpc } from "../../client/data.js";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { TYPE_ICONS } from "../../components/task-meta.js";

type ParentCandidate = Pick<Task, "id" | "key" | "title" | "type" | "parentTaskId">;

/**
 * The tasks that can become this task's parent: any on the board but itself
 * and what lies under it — either would close a loop. Epics first, since
 * putting a task into an epic is what the menu is mostly for; board order
 * inside each group.
 */
export function parentOptions<T extends ParentCandidate>(taskId: string, tasks: readonly T[]): T[] {
  const under = new Set((descendantsOf(tasks).get(taskId) ?? []).map(({ task }) => task.id));
  const allowed = tasks.filter((task) => task.id !== taskId && !under.has(task.id));
  return [...allowed.filter((task) => task.type === "epic"), ...allowed.filter((task) => task.type !== "epic")];
}

/**
 * The task's parent, chosen from the board's tasks with a search by key and
 * title. A task goes into an epic by taking the epic as its parent. The
 * board is asked for on open — a closed menu needs none of it.
 */
export function ParentPicker({
  task,
  parent,
  onSelect,
  triggerClassName,
}: {
  task: Task;
  parent: Pick<Task, "key" | "title" | "type"> | null;
  onSelect: (parentTaskId: string | null) => void;
  triggerClassName: string;
}) {
  const rpc = useTasksRpc();
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);

  const openChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    void listAllTasks(rpc, { projectId: task.projectId }).then(setTasks, () => setTasks([]));
  };
  const select = (next: string | null) => {
    setOpen(false);
    if (next !== task.parentTaskId) onSelect(next);
  };

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Edit parent" className={cn(triggerClassName, "min-w-0")}>
          <Icon name={parent?.type ? TYPE_ICONS[parent.type] : "GitBranch"} className="size-3.5 shrink-0" />
          <span className="truncate">{parent ? `${parent.key} ${parent.title}` : "No parent"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Parent…" />
          <CommandList>
            <CommandGroup>
              <CommandItem value="No parent" onSelect={() => select(null)}>
                <span className="flex-1">No parent</span>
                {task.parentTaskId === null ? <Icon name="Check" className="size-3.5" /> : null}
              </CommandItem>
              {parentOptions(task.id, tasks).map((option) => (
                <CommandItem key={option.id} value={`${option.key} ${option.title}`} onSelect={() => select(option.id)}>
                  {option.type ? <Icon name={TYPE_ICONS[option.type]} className="size-3.5 shrink-0" /> : null}
                  <span className="shrink-0 text-muted-foreground tabular-nums">{option.key}</span>
                  <span className="min-w-0 flex-1 truncate">{option.title}</span>
                  {option.id === task.parentTaskId ? <Icon name="Check" className="size-3.5" /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
