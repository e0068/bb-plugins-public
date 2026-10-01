import { useState } from "react";
import type { Label, Project, Task } from "../../shared/contract.js";
import { Icon } from "@/components/ui/icon";
import { PriorityEditor, StatusEditor, type EditFn } from "../common/property-menus.js";
import { formatDollars, formatMinutes } from "../../shared/amounts.js";
import type { RowField } from "../common/row-field-preference.js";
import { formatDueDate, formatTimestamp, PRIORITY_LABELS, STATUS_LABELS } from "../common/lib.js";
import { EstimateIcon, TYPE_ICONS, TYPE_LABELS } from "../../components/task-meta.js";
import { slugOf } from "../../shared/format.js";

/** Everything a cell needs beyond the task and column: cross-task lookups
 * (project, labels, keys of a parent/epic), computed metadata (active
 * threads, sub-task progress) and the client's "Show empty values" choice. */
export interface CellContext {
  project: Project | undefined;
  labelsById: ReadonlyMap<string, Label>;
  taskKeys: ReadonlyMap<string, string>;
  activeThreads: number;
  subtasks: { done: number; total: number };
  showEmpty: boolean;
  onEdit: EditFn;
}

const EMPTY_DASH_CLASS = "text-subtle-foreground/60";

/** A field with no value: blank normally, an em-dash when the client asked
 * empty fields to render rather than collapse. */
function CellEmpty({ showEmpty }: { showEmpty: boolean }) {
  return showEmpty ? <span className={EMPTY_DASH_CLASS}>—</span> : null;
}

/** Plain text value, or {@link CellEmpty} when `value` is absent. */
function CellText({ value, showEmpty }: { value: string | null; showEmpty: boolean }) {
  if (value === null) return <CellEmpty showEmpty={showEmpty} />;
  return <span className="truncate">{value}</span>;
}

function keyOf(taskId: string | null, taskKeys: ReadonlyMap<string, string>): string | null {
  if (taskId === null) return null;
  return taskKeys.get(taskId) ?? null;
}

function labelNames(labelIds: readonly string[], labelsById: ReadonlyMap<string, Label>): string | null {
  const names = labelIds.flatMap((id) => {
    const label = labelsById.get(id);
    return label ? [label.name] : [];
  });
  return names.length > 0 ? names.join(", ") : null;
}

/** The description's first paragraph — a table row has no room for the rest. */
function firstParagraph(description: string): string | null {
  const trimmed = description.trim();
  if (trimmed === "") return null;
  return trimmed.split(/\n\n+/)[0] ?? null;
}

/** Status is never absent, and edits inline: the same trigger this task's
 * list row and board card use, so the picker menu is identical everywhere. */
function StatusCell({ task, onEdit }: { task: Task; onEdit: EditFn }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <StatusEditor task={task} onEdit={onEdit} open={open} onOpenChange={setOpen} />
      <span className="truncate">{STATUS_LABELS[task.status]}</span>
    </span>
  );
}

/** "none" is the model's absence sentinel for priority — the table shows no
 * label for it, yet the picker stays there to set one. */
function PriorityCell({ task, showEmpty, onEdit }: { task: Task; showEmpty: boolean; onEdit: EditFn }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <PriorityEditor task={task} onEdit={onEdit} open={open} onOpenChange={setOpen} />
      {task.priority === "none" ? (
        <CellEmpty showEmpty={showEmpty} />
      ) : (
        <span className="truncate">{PRIORITY_LABELS[task.priority]}</span>
      )}
    </span>
  );
}

function TypeCell({ task, showEmpty }: { task: Task; showEmpty: boolean }) {
  if (task.type === null) return <CellEmpty showEmpty={showEmpty} />;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Icon name={TYPE_ICONS[task.type]} className="size-3.5 shrink-0" />
      <span className="truncate">{TYPE_LABELS[task.type]}</span>
    </span>
  );
}

function EstimateCell({ task, showEmpty }: { task: Task; showEmpty: boolean }) {
  if (task.estimate === null) return <CellEmpty showEmpty={showEmpty} />;
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Icon name="Timer" className="size-3.5 shrink-0" />
      <EstimateIcon estimate={task.estimate} />
    </span>
  );
}

/**
 * One table cell's value: a plain field reads as text with an icon for the
 * four glyph fields (status, priority, type, estimate), or as bare text
 * otherwise; an absent value is blank, or an em-dash under "Show empty
 * values". Status and priority edit in place, as on the list row before;
 * type and estimate are set in the task's detail rail.
 */
export function TableCell({
  column,
  task,
  context,
}: {
  column: RowField;
  task: Task;
  context: CellContext;
}) {
  switch (column) {
    case "status":
      return <StatusCell task={task} onEdit={context.onEdit} />;
    case "priority":
      return <PriorityCell task={task} showEmpty={context.showEmpty} onEdit={context.onEdit} />;
    case "type":
      return <TypeCell task={task} showEmpty={context.showEmpty} />;
    case "estimate":
      return <EstimateCell task={task} showEmpty={context.showEmpty} />;
    case "key":
      return <CellText value={task.key} showEmpty={context.showEmpty} />;
    case "parent":
      return <CellText value={keyOf(task.parentTaskId, context.taskKeys)} showEmpty={context.showEmpty} />;
    case "epic":
      return <CellText value={keyOf(task.epicId ?? null, context.taskKeys)} showEmpty={context.showEmpty} />;
    case "flow":
      return <CellText value={task.flow?.name ?? null} showEmpty={context.showEmpty} />;
    case "takenBy":
      return <CellText value={task.takenBy?.machine ?? null} showEmpty={context.showEmpty} />;
    case "assignee":
      return <CellText value={task.assignee ?? null} showEmpty={context.showEmpty} />;
    case "labels":
      return <CellText value={labelNames(task.labelIds, context.labelsById)} showEmpty={context.showEmpty} />;
    case "project":
      return <CellText value={context.project?.name ?? null} showEmpty={context.showEmpty} />;
    case "dueDate":
      return <CellText value={task.dueDate !== null ? formatDueDate(task.dueDate) : null} showEmpty={context.showEmpty} />;
    case "startDate":
      return <CellText value={task.startDate !== null ? formatDueDate(task.startDate) : null} showEmpty={context.showEmpty} />;
    case "plannedMinutes":
      return <CellText value={task.plannedMinutes !== null ? formatMinutes(task.plannedMinutes) : null} showEmpty={context.showEmpty} />;
    case "actualMinutes":
      return <CellText value={task.actualMinutes !== null ? formatMinutes(task.actualMinutes) : null} showEmpty={context.showEmpty} />;
    case "budget":
      return <CellText value={task.budget !== null ? formatDollars(task.budget) : null} showEmpty={context.showEmpty} />;
    case "budgetLimit":
      return <CellText value={task.budgetLimit !== null ? formatDollars(task.budgetLimit) : null} showEmpty={context.showEmpty} />;
    case "cost":
      return <CellText value={task.cost !== null ? formatDollars(task.cost) : null} showEmpty={context.showEmpty} />;
    case "description":
      return <CellText value={firstParagraph(task.description)} showEmpty={context.showEmpty} />;
    case "subtasks":
      return <CellText value={`${context.subtasks.done} / ${context.subtasks.total}`} showEmpty={context.showEmpty} />;
    case "active":
      return <CellText value={context.activeThreads > 0 ? "Active" : null} showEmpty={context.showEmpty} />;
    case "createdAt":
      return <CellText value={formatTimestamp(task.createdAt)} showEmpty={context.showEmpty} />;
    case "updatedAt":
      return <CellText value={formatTimestamp(task.updatedAt)} showEmpty={context.showEmpty} />;
    case "slug":
      return <CellText value={slugOf(task.id)} showEmpty={context.showEmpty} />;
    // The title column renders through `TitleCell`; the rest are fields the
    // table does not draw as a value of their own.
    case "title":
    case "attachments":
    case "worktree":
    case "subtaskList":
    case "subtaskStats":
    case "burndown":
    case "gantt":
      return <CellEmpty showEmpty={context.showEmpty} />;
  }
}

/** One lead's width and the gap after it — the step each nesting level indents by. */
const LEAD_STEP_REM = 1.375;

/**
 * The title column: the task's title after its lead — the fold toggle when
 * it has sub-tasks, a tree mark of the toggle's width when it is a sub-task
 * without any, nothing for a top-level task without any — and the sub-task
 * count after the title. Every level under the top, the first included,
 * steps in by one lead.
 */
export function TitleCell({
  task,
  depth,
  childCount,
  collapsed,
  onToggle,
  onOpen,
}: {
  task: Task;
  depth: number;
  childCount: number;
  collapsed: boolean;
  onToggle: () => void;
  /** Opens the task from the keyboard as well as by click; the row alone is mouse-only. */
  onOpen?: () => void;
}) {
  const indent = depth * LEAD_STEP_REM;
  return (
    <span className="flex min-w-0 items-center gap-1.5" style={indent > 0 ? { paddingLeft: `${indent}rem` } : undefined}>
      {childCount > 0 ? (
        <button
          type="button"
          data-title-lead="toggle"
          aria-label={collapsed ? "Expand sub-tasks" : "Collapse sub-tasks"}
          onClick={onToggle}
          className="flex size-4 shrink-0 items-center justify-center rounded-sm text-subtle-foreground hover:bg-state-hover hover:text-foreground"
        >
          <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} className="size-3.5" />
        </button>
      ) : depth > 0 ? (
        <span
          aria-hidden
          data-title-lead="branch"
          className="flex size-4 shrink-0 items-center justify-center text-subtle-foreground"
        >
          <Icon name="CornerDownRight" className="size-3.5" />
        </span>
      ) : null}
      {onOpen ? (
        <button
          type="button"
          aria-label={`Open ${task.key}: ${task.title}`}
          onClick={onOpen}
          className="min-w-0 truncate text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {task.title}
        </button>
      ) : (
        <span className="min-w-0 truncate">{task.title}</span>
      )}
      {childCount > 0 ? (
        <span className="shrink-0 text-2xs tabular-nums text-subtle-foreground">{childCount}</span>
      ) : null}
    </span>
  );
}
