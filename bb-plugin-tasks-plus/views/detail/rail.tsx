import { useState, type ReactNode } from "react";
import type {
  Label,
  Project,
  Task,
  TaskCheck,
  TaskEstimate,
  TaskPriority,
  TaskStatus,
  TaskThread,
  TaskType,
} from "../../shared/contract.js";
import {
  TASK_CHECKS,
  TASK_ESTIMATES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
} from "../../shared/contract.js";
import type { Preset } from "../../shared/contract.js";
import { useTasksQuery, useTasksRpc } from "../../shell/data.js";
import {
  CHECK_LABELS,
  ESTIMATE_LABELS,
  ESTIMATE_OPTION_LABELS,
  PRIORITY_LABELS,
  PriorityIcon,
  STATUS_LABELS,
  StatusIcon,
  TYPE_ICONS,
  TYPE_LABELS,
  TYPE_NONE_ICON,
  formatDueDate,
  isActiveThread,
} from "./meta.js";
import { DispatchControl } from "./threads.js";
import { DEFAULT_COLOR } from "../manage/shared.js";
import {
  BbProjectLinkPicker,
  bbProjectLinkStateFor,
  emptyBbProjectLinkState,
  resolveBbProjectLink,
  type BbProjectLinkState,
} from "../manage/bb-project-link.js";
import type { BbProjectOption } from "../../shared/contract.js";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface TaskPropertyUpdate {
  status?: TaskStatus;
  priority?: TaskPriority;
  type?: TaskType | null;
  estimate?: TaskEstimate | null;
  planTokens?: number | null;
  factTokens?: number | null;
  checks?: TaskCheck[];
  dueDate?: string | null;
  labelIds?: string[];
}

export interface TaskPropertiesProps {
  task: Task;
  project: Project | undefined;
  labels: Label[] | undefined;
  threads: TaskThread[];
  onUpdate: (update: TaskPropertyUpdate) => void;
}

function localIsoDate(daysFromNow: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Shared shape for the small "value + optional remove button" pills used
 * throughout the rail (labels, checks, …). Callers own their own color/size
 * treatment via `className`; this only owns the remove-button behavior so it
 * stays identical everywhere it appears.
 */
function RemovableChip({
  className,
  children,
  onRemove,
  removeLabel,
}: {
  className: string;
  children: ReactNode;
  onRemove?: () => void;
  removeLabel: string;
}) {
  return (
    <span className={className}>
      {children}
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel}
          className="-mr-0.5 rounded-sm hover:text-foreground"
          onClick={onRemove}
        >
          <Icon name="X" className="size-2.5" />
        </button>
      ) : null}
    </span>
  );
}

function LabelChip({
  label,
  onRemove,
}: {
  label: Label;
  onRemove?: () => void;
}) {
  return (
    <RemovableChip
      className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs text-foreground"
      onRemove={onRemove}
      removeLabel={`Remove ${label.name}`}
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ backgroundColor: label.color }}
      />
      {label.name}
    </RemovableChip>
  );
}

function StatusMenu({
  task,
  onUpdate,
  triggerClassName,
}: {
  task: Task;
  onUpdate: (update: TaskPropertyUpdate) => void;
  triggerClassName: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={triggerClassName}>
          <StatusIcon status={task.status} />
          {STATUS_LABELS[task.status]}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {TASK_STATUSES.map((status) => (
          <DropdownMenuItem
            key={status}
            onSelect={() => onUpdate({ status })}
          >
            <StatusIcon status={status} />
            {STATUS_LABELS[status]}
            {status === task.status ? (
              <Icon name="Check" className="ml-auto size-3.5" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PriorityMenu({
  task,
  onUpdate,
  triggerClassName,
}: {
  task: Task;
  onUpdate: (update: TaskPropertyUpdate) => void;
  triggerClassName: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={triggerClassName}>
          <PriorityIcon priority={task.priority} />
          {PRIORITY_LABELS[task.priority]}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {TASK_PRIORITIES.map((priority) => (
          <DropdownMenuItem
            key={priority}
            onSelect={() => onUpdate({ priority })}
          >
            <PriorityIcon priority={priority} />
            {PRIORITY_LABELS[priority]}
            {priority === task.priority ? (
              <Icon name="Check" className="ml-auto size-3.5" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EnumMenu<T extends string>({
  value,
  values,
  labels,
  optionLabels,
  noneLabel,
  onSelect,
  triggerClassName,
  renderIcon,
}: {
  value: T | null;
  values: readonly T[];
  labels: Record<T, string>;
  // Longer text for the dropdown items; the trigger always uses `labels`.
  optionLabels?: Record<T, string>;
  noneLabel: string;
  onSelect: (next: T | null) => void;
  triggerClassName: string;
  renderIcon?: (value: T | null) => ReactNode;
}) {
  const itemLabels = optionLabels ?? labels;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={triggerClassName}>
          {renderIcon?.(value)}
          {value === null ? noneLabel : labels[value]}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => onSelect(null)}>
          {renderIcon?.(null)}
          {noneLabel}
          {value === null ? (
            <Icon name="Check" className="ml-auto size-3.5" />
          ) : null}
        </DropdownMenuItem>
        {values.map((item) => (
          <DropdownMenuItem key={item} onSelect={() => onSelect(item)}>
            {renderIcon?.(item)}
            {itemLabels[item]}
            {item === value ? (
              <Icon name="Check" className="ml-auto size-3.5" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CheckChip({
  check,
  onRemove,
}: {
  check: TaskCheck;
  onRemove?: () => void;
}) {
  return (
    <RemovableChip
      className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs text-foreground"
      onRemove={onRemove}
      removeLabel={`Remove ${CHECK_LABELS[check]}`}
    >
      {CHECK_LABELS[check]}
    </RemovableChip>
  );
}

function ChecksMenu({
  task,
  onUpdate,
  children,
}: {
  task: Task;
  onUpdate: (update: TaskPropertyUpdate) => void;
  children: ReactNode;
}) {
  const toggle = (check: TaskCheck) => {
    const next = task.checks.includes(check)
      ? task.checks.filter((item) => item !== check)
      : [...task.checks, check];
    onUpdate({ checks: next });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {TASK_CHECKS.map((check) => (
          <DropdownMenuItem
            key={check}
            onSelect={(event) => {
              // Keep the menu open so several checks can be toggled at once.
              event.preventDefault();
              toggle(check);
            }}
          >
            {CHECK_LABELS[check]}
            {task.checks.includes(check) ? (
              <Icon name="Check" className="ml-auto size-3.5" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TokenField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number | null;
  onCommit: (next: number | null) => void;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      if (value !== null) onCommit(null);
      return;
    }
    const next = Number(trimmed);
    if (!Number.isInteger(next) || next < 0) {
      // Reject junk by reverting to the persisted value.
      setDraft(value === null ? "" : String(value));
      return;
    }
    if (next !== value) onCommit(next);
  };
  return (
    <label className="flex flex-col gap-1">
      <span className="text-2xs font-semibold text-muted-foreground">
        {label}
      </span>
      <Input
        type="number"
        min={0}
        inputMode="numeric"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        className="h-8 w-full [appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </label>
  );
}

function DueDateMenu({
  task,
  onUpdate,
  triggerClassName,
}: {
  task: Task;
  onUpdate: (update: TaskPropertyUpdate) => void;
  triggerClassName: string;
}) {
  const [open, setOpen] = useState(false);
  const pick = (dueDate: string | null) => {
    onUpdate({ dueDate });
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={triggerClassName}>
          <Icon name="Clock" className="size-3.5 shrink-0" />
          {task.dueDate ? formatDueDate(task.dueDate) : "Set due date"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-2">
        <div className="flex flex-col">
          {(
            [
              ["Today", 0],
              ["Tomorrow", 1],
              ["Next week", 7],
            ] as const
          ).map(([label, days]) => (
            <button
              key={label}
              type="button"
              className="flex items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
              onClick={() => pick(localIsoDate(days))}
            >
              {label}
              <span className="text-xs text-muted-foreground">
                {formatDueDate(localIsoDate(days))}
              </span>
            </button>
          ))}
          <input
            type="date"
            aria-label="Due date"
            className="mt-1 h-7 rounded-md border border-input bg-transparent px-2 text-sm text-foreground"
            value={task.dueDate ?? ""}
            onChange={(event) => {
              if (event.target.value) pick(event.target.value);
            }}
          />
          {task.dueDate ? (
            <button
              type="button"
              className="mt-1 flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={() => pick(null)}
            >
              <Icon name="X" className="size-3.5" />
              Remove due date
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LabelsMenu({
  task,
  labels,
  onUpdate,
  children,
}: {
  task: Task;
  labels: Label[] | undefined;
  onUpdate: (update: TaskPropertyUpdate) => void;
  children: React.ReactNode;
}) {
  const rpc = useTasksRpc();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const toggle = (labelId: string) => {
    const next = task.labelIds.includes(labelId)
      ? task.labelIds.filter((id) => id !== labelId)
      : [...task.labelIds, labelId];
    onUpdate({ labelIds: next });
  };

  // Inline label creation: from the query when it matches nothing, or from
  // the "New label" row when the project has no labels yet. The created
  // label is attached to the task right away.
  const createLabel = async (name: string) => {
    if (!name || creating) return;
    setCreating(true);
    try {
      const { label } = await rpc.call("createLabel", {
        projectId: task.projectId,
        name,
        color: DEFAULT_COLOR,
      });
      onUpdate({ labelIds: [...task.labelIds, label.id] });
      setQuery("");
    } finally {
      setCreating(false);
    }
  };

  const labelList = labels ?? [];
  return (
    <Popover onOpenChange={(open) => open || setQuery("")}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput
            placeholder="Add labels…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty
              className={query.trim() !== "" ? "p-1 text-left" : undefined}
            >
              {query.trim() !== "" ? (
                <button
                  type="button"
                  disabled={creating}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  onClick={() => void createLabel(query.trim())}
                >
                  <Icon name="Plus" className="size-3.5" />
                  Create “{query.trim()}”
                </button>
              ) : (
                "No labels in this project."
              )}
            </CommandEmpty>
            {labels !== undefined && labelList.length === 0 ? (
              <CommandGroup>
                <CommandItem
                  disabled={creating}
                  onSelect={() => {
                    const name = query.trim();
                    if (name) void createLabel(name);
                  }}
                >
                  <Icon name="Plus" className="size-3.5" />
                  New label{query.trim() ? ` “${query.trim()}”` : "…"}
                </CommandItem>
              </CommandGroup>
            ) : null}
            {/* Rendered only when labels exist: an empty cmdk group still
                paints its p-1 padding, leaving a dead band under "New label…". */}
            {labelList.length > 0 ? (
              <CommandGroup>
                {labelList.map((label) => (
                  <CommandItem
                    key={label.id}
                    value={label.name}
                    onSelect={() => toggle(label.id)}
                  >
                    <span
                      aria-hidden
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: label.color }}
                    />
                    <span className="flex-1">{label.name}</span>
                    {task.labelIds.includes(label.id) ? (
                      <Icon name="Check" className="size-3.5" />
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Editable "Dispatch target" row: shows the linked bb project (or an invite
 * to link one) and opens a picker that saves via updateProject. The rail's
 * project data is subscribed to projects:changed, so the row refreshes as
 * soon as the save publishes.
 */
function DispatchTargetMenu({
  project,
  bbProjects,
  onError,
  triggerClassName,
}: {
  project: Project;
  bbProjects: readonly BbProjectOption[];
  onError: (message: string) => void;
  triggerClassName: string;
}) {
  const rpc = useTasksRpc();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<BbProjectLinkState>(
    emptyBbProjectLinkState,
  );
  const [saving, setSaving] = useState(false);
  const linkedBbProjectId = project.linkedBbProjectId;
  const linkedName = bbProjects.find(
    (candidate) => candidate.id === linkedBbProjectId,
  )?.name;
  const resolved = resolveBbProjectLink(state);

  const save = async (linkedId: string | null) => {
    if (saving) return;
    setSaving(true);
    try {
      await rpc.call("updateProject", {
        projectId: project.id,
        linkedBbProjectId: linkedId,
      });
      setOpen(false);
    } catch (saveError) {
      onError(
        saveError instanceof Error ? saveError.message : String(saveError),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setState(bbProjectLinkStateFor(linkedBbProjectId));
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Edit dispatch target"
          className={triggerClassName}
        >
          <Icon name="ArrowUpRight" className="size-3.5 shrink-0" />
          {linkedBbProjectId !== null ? (
            <span className="truncate" title={linkedBbProjectId}>
              {linkedName ?? linkedBbProjectId}
            </span>
          ) : (
            <span className="truncate text-muted-foreground">
              Link a bb project…
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <BbProjectLinkPicker
          state={state}
          onStateChange={setState}
          bbProjects={bbProjects}
          noneLabel={linkedBbProjectId !== null ? "Unlink" : "Not linked"}
        />
        <div className="mt-2.5 flex items-center justify-between gap-2">
          {linkedBbProjectId !== null ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-muted-foreground"
              disabled={saving}
              onClick={() => void save(null)}
            >
              <Icon name="X" className="size-3.5" />
              Unlink
            </Button>
          ) : (
            <span />
          )}
          <Button
            size="sm"
            className="h-7"
            disabled={saving}
            onClick={() => void save(resolved === "" ? null : resolved)}
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const RAIL_ROW_CLASS =
  "-mx-1.5 flex w-[calc(100%+0.75rem)] items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-state-hover";

/** Right-hand properties rail (hidden below the container breakpoint). */
function SourceRow({
  task,
  onError,
}: {
  task: Task;
  onError: (message: string) => void;
}) {
  const rpc = useTasksRpc();
  if (task.source === null) return null;
  const filePath = task.source.filePath;
  const name = filePath.split("/").pop() ?? filePath;
  const reveal = async () => {
    try {
      const { revealed, error } = await rpc.call("revealTaskSource", {
        taskId: task.id,
      });
      if (!revealed) onError(error ?? "Не удалось раскрыть файл-источник");
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <>
      <div className="mb-1 mt-3 text-2xs font-semibold text-muted-foreground">
        Источник
      </div>
      <button
        type="button"
        onClick={() => void reveal()}
        title={filePath}
        className="flex w-full items-center gap-1.5 rounded-md py-0.5 text-left text-sm text-foreground hover:underline"
      >
        <Icon name="FileText" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate">{name}</span>
        <Icon
          name="FolderOpen"
          className="ml-auto size-3 shrink-0 text-muted-foreground"
        />
      </button>
    </>
  );
}

export function PropertiesRail({
  task,
  project,
  labels,
  threads,
  presets,
  onUpdate,
  onError,
  className,
}: TaskPropertiesProps & {
  presets: Preset[] | undefined;
  onError: (message: string) => void;
  className?: string;
}) {
  const taskLabels = (labels ?? []).filter((label) =>
    task.labelIds.includes(label.id),
  );
  const active = threads.filter(isActiveThread);
  // Fetched unconditionally: the picker needs the workspace list even when
  // the project is not linked yet.
  const bbProjects = useTasksQuery(
    async (query) => (await query.call("listBbProjects")).bbProjects,
    ["projects:changed"],
  );
  return (
    <aside className={cn("w-56 shrink-0 py-10 pl-2 pr-6", className)}>
      <h2 className="mb-1.5 text-xs font-semibold text-muted-foreground">
        Properties
      </h2>
      <StatusMenu task={task} onUpdate={onUpdate} triggerClassName={RAIL_ROW_CLASS} />
      <PriorityMenu
        task={task}
        onUpdate={onUpdate}
        triggerClassName={RAIL_ROW_CLASS}
      />
      <DueDateMenu task={task} onUpdate={onUpdate} triggerClassName={RAIL_ROW_CLASS} />
      <EnumMenu
        value={task.type}
        values={TASK_TYPES}
        labels={TYPE_LABELS}
        noneLabel="No type"
        onSelect={(type) => onUpdate({ type })}
        triggerClassName={RAIL_ROW_CLASS}
        renderIcon={(value) => (
          <Icon
            name={value ? TYPE_ICONS[value] : TYPE_NONE_ICON}
            className="size-3.5"
          />
        )}
      />
      <EnumMenu
        value={task.estimate}
        values={TASK_ESTIMATES}
        labels={ESTIMATE_LABELS}
        optionLabels={ESTIMATE_OPTION_LABELS}
        noneLabel="No estimate"
        onSelect={(estimate) => onUpdate({ estimate })}
        triggerClassName={RAIL_ROW_CLASS}
      />

      <div className="mb-1 mt-3 text-2xs font-semibold text-muted-foreground">
        Checks
      </div>
      <div className="flex flex-wrap items-center gap-1 py-0.5">
        {task.checks.map((check) => (
          <CheckChip
            key={check}
            check={check}
            onRemove={() =>
              onUpdate({
                checks: task.checks.filter((item) => item !== check),
              })
            }
          />
        ))}
        <ChecksMenu task={task} onUpdate={onUpdate}>
          <button
            type="button"
            aria-label="Edit checks"
            className="inline-flex items-center rounded-md border border-dashed border-border px-1.5 py-0.5 text-muted-foreground hover:border-input hover:text-foreground"
          >
            <Icon name="Plus" className="size-3" />
          </button>
        </ChecksMenu>
      </div>

      <div className="mb-1 mt-3 text-2xs font-semibold text-muted-foreground">
        Labels
      </div>
      <div className="flex flex-wrap items-center gap-1 py-0.5">
        {taskLabels.map((label) => (
          <LabelChip
            key={label.id}
            label={label}
            onRemove={() =>
              onUpdate({
                labelIds: task.labelIds.filter((id) => id !== label.id),
              })
            }
          />
        ))}
        <LabelsMenu task={task} labels={labels} onUpdate={onUpdate}>
          <button
            type="button"
            aria-label="Edit labels"
            className="inline-flex items-center rounded-md border border-dashed border-border px-1.5 py-0.5 text-muted-foreground hover:border-input hover:text-foreground"
          >
            <Icon name="Plus" className="size-3" />
          </button>
        </LabelsMenu>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <TokenField
          label="Tokens - Plan"
          value={task.planTokens}
          onCommit={(planTokens) => onUpdate({ planTokens })}
        />
        <TokenField
          label="Tokens - Fact"
          value={task.factTokens}
          onCommit={(factTokens) => onUpdate({ factTokens })}
        />
      </div>

      <SourceRow task={task} onError={onError} />

      <div className="mb-1 mt-3 text-2xs font-semibold text-muted-foreground">
        Project
      </div>
      <div className="flex items-center gap-2 py-0.5 text-sm">
        <span
          aria-hidden
          className="size-3 shrink-0 rounded-sm"
          style={{ backgroundColor: project?.color }}
        />
        <span className="truncate">{project?.name ?? "…"}</span>
      </div>

      <div className="mb-1 mt-3 text-2xs font-semibold text-muted-foreground">
        Dispatch target
      </div>
      {project !== undefined ? (
        <DispatchTargetMenu
          project={project}
          bbProjects={bbProjects.data ?? []}
          onError={onError}
          triggerClassName={RAIL_ROW_CLASS}
        />
      ) : (
        <div className="py-0.5 text-sm text-muted-foreground">…</div>
      )}

      <div className="mt-2.5 py-0.5">
        <DispatchControl
          taskId={task.id}
          presets={presets}
          onError={onError}
          align="start"
          className="w-full"
        />
      </div>

      <div className="mb-1 mt-3 text-2xs font-semibold text-muted-foreground">
        Agents
      </div>
      <div className="flex flex-col gap-1 py-0.5 text-xs">
        {active.length > 0 ? (
          active.map((thread) => (
            <span
              key={thread.id}
              className="flex items-center gap-1.5 font-medium text-success"
            >
              <span
                aria-hidden
                className="size-1.5 shrink-0 animate-pulse rounded-full bg-success"
              />
              <span className="truncate">
                {thread.presetName}{" "}
                {thread.liveStatus === "starting" ? "starting" : "working"}
              </span>
            </span>
          ))
        ) : (
          <span className="text-muted-foreground">none active</span>
        )}
      </div>
    </aside>
  );
}

const CHIP_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-0.5 text-xs text-foreground hover:border-input";

// Same pill with the fill removed: marks an optional property that is currently
// empty (the due date, which may legitimately have no value) so it reads as an
// affordance to set rather than as a value already chosen.
const CHIP_GHOST_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:border-input hover:text-foreground";

// Non-interactive variant for the project, shown in the row but edited elsewhere.
const CHIP_STATIC_CLASS =
  "inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2.5 py-0.5 text-xs text-foreground";

/** Compact property chips shown under the title when the rail is hidden.
 *  Mirrors the rail's fields as pills — every set property (status, priority,
 *  type, estimate, project, labels, checks) plus the due date, which stays
 *  visible even when empty as a ghost pill. Carries the task's single
 *  DispatchControl full-width beneath the pills. */
export function InlineProperties({
  task,
  project,
  labels,
  presets,
  onUpdate,
  onError,
  className,
}: Omit<TaskPropertiesProps, "threads"> & {
  presets: Preset[] | undefined;
  onError: (message: string) => void;
  className?: string;
}) {
  const taskLabels = (labels ?? []).filter((label) =>
    task.labelIds.includes(label.id),
  );
  const checks = task.checks ?? [];
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusMenu task={task} onUpdate={onUpdate} triggerClassName={CHIP_CLASS} />
        <PriorityMenu
          task={task}
          onUpdate={onUpdate}
          triggerClassName={CHIP_CLASS}
        />
        <DueDateMenu
          task={task}
          onUpdate={onUpdate}
          triggerClassName={task.dueDate ? CHIP_CLASS : CHIP_GHOST_CLASS}
        />
        {task.type ? (
          <EnumMenu
            value={task.type}
            values={TASK_TYPES}
            labels={TYPE_LABELS}
            noneLabel="No type"
            onSelect={(type) => onUpdate({ type })}
            triggerClassName={CHIP_CLASS}
            renderIcon={(value) => (
              <Icon
                name={value ? TYPE_ICONS[value] : TYPE_NONE_ICON}
                className="size-3.5"
              />
            )}
          />
        ) : null}
        {task.estimate ? (
          <EnumMenu
            value={task.estimate}
            values={TASK_ESTIMATES}
            labels={ESTIMATE_LABELS}
            optionLabels={ESTIMATE_OPTION_LABELS}
            noneLabel="No estimate"
            onSelect={(estimate) => onUpdate({ estimate })}
            triggerClassName={CHIP_CLASS}
          />
        ) : null}
        {project ? (
          <span className={CHIP_STATIC_CLASS}>
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-sm"
              style={{ backgroundColor: project.color }}
            />
            {project.name}
          </span>
        ) : null}
        {taskLabels.map((label) => (
          <LabelChip
            key={label.id}
            label={label}
            onRemove={() =>
              onUpdate({
                labelIds: task.labelIds.filter((id) => id !== label.id),
              })
            }
          />
        ))}
        <LabelsMenu task={task} labels={labels} onUpdate={onUpdate}>
          <button
            type="button"
            aria-label="Edit labels"
            className="inline-flex items-center rounded-md border border-dashed border-border px-2 py-1 text-muted-foreground hover:border-input hover:text-foreground"
          >
            <Icon name="Plus" className="size-3" />
          </button>
        </LabelsMenu>
        {checks.map((check) => (
          <CheckChip
            key={check}
            check={check}
            onRemove={() =>
              onUpdate({ checks: checks.filter((item) => item !== check) })
            }
          />
        ))}
        <ChecksMenu task={task} onUpdate={onUpdate}>
          <button
            type="button"
            aria-label="Edit checks"
            className="inline-flex items-center rounded-md border border-dashed border-border px-2 py-1 text-muted-foreground hover:border-input hover:text-foreground"
          >
            <Icon name="Plus" className="size-3" />
          </button>
        </ChecksMenu>
      </div>
      <DispatchControl
        taskId={task.id}
        presets={presets}
        onError={onError}
        align="start"
        className="w-full"
      />
    </div>
  );
}
