import { useMemo, useState } from "react";
import type {
  Label,
  Project,
  Task,
  TaskThread,
} from "../../shared/contract.js";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { TaskRowMeta } from "./data.js";
import {
  activeWorkLabel,
  formatDueDate,
  formatTimestamp,
  formatTokenCount,
  partitionLabels,
} from "./lib.js";
import { planRowFields } from "./field-plan.js";
import {
  ROW_FIELD_LABELS,
  type FieldDisplayConfig,
  type RowField,
} from "./row-field-preference.js";
import { PriorityIcon } from "./icons.js";
import { PRIORITY_LABELS } from "./lib.js";
import type { EditFn } from "./property-menus.js";
import {
  isBareKey,
  PriorityEditor,
  StatusEditor,
  TaskContextMenu,
} from "./property-menus.js";
import {
  EstimateIcon,
  TYPE_ICONS,
  TYPE_LABELS,
} from "../detail/meta.js";

/**
 * Every trailing-rail element shares this pill treatment (Linear-style), so
 * the rail reads as one aligned system rather than mixed chips and bare text.
 */
const RAIL_CHIP_CLASS =
  "flex items-center gap-1 rounded-md border border-border px-1.5 py-px text-xs text-muted-foreground";

/**
 * Icon-only rail elements (Type, Estimate, Priority) read as glyphs, not chips:
 * they drop the pill's border and padding so a lone icon isn't boxed, while
 * keeping the rail's alignment and muted color.
 */
const RAIL_ICON_CLASS = "flex items-center text-muted-foreground";

/**
 * Live-activity chip: a green dot plus an "Active" pill, styled like the label
 * chips so the rail stays uniform. The pill text stays constant; the tooltip
 * carries the specific state (starting vs working, agent count).
 */
function ActiveChip({ threads }: { threads: readonly TaskThread[] }) {
  return (
    <span title={activeWorkLabel(threads)} className={RAIL_CHIP_CLASS}>
      <span
        aria-hidden
        className="size-1.5 shrink-0 animate-pulse rounded-full bg-success"
      />
      Active
    </span>
  );
}

function PriorityChip({ priority }: { priority: Task["priority"] }) {
  return (
    <span title={PRIORITY_LABELS[priority]} className={RAIL_ICON_CLASS}>
      <PriorityIcon priority={priority} />
    </span>
  );
}

function TypeChip({ type }: { type: NonNullable<Task["type"]> }) {
  return (
    <span title={TYPE_LABELS[type]} className={RAIL_ICON_CLASS}>
      <Icon name={TYPE_ICONS[type]} className="size-3 shrink-0" />
    </span>
  );
}

function EstimateChip({ estimate }: { estimate: NonNullable<Task["estimate"]> }) {
  return (
    <span title={`Estimate: ${estimate.toUpperCase()}`} className={RAIL_ICON_CLASS}>
      <EstimateIcon estimate={estimate} />
    </span>
  );
}

function TokensChip({
  planTokens,
  factTokens,
}: {
  planTokens: number | null;
  factTokens: number | null;
}) {
  const plan = planTokens === null ? "—" : formatTokenCount(planTokens);
  const fact = factTokens === null ? "—" : formatTokenCount(factTokens);
  return (
    <span
      title={`Tokens — plan ${plan}, fact ${fact}`}
      className={`${RAIL_CHIP_CLASS} tabular-nums`}
    >
      <Icon name="AiContentGenerator01" className="size-3 shrink-0" />
      {plan} / {fact}
    </span>
  );
}

function DateChip({
  icon,
  title,
  value,
}: {
  icon: Parameters<typeof Icon>[0]["name"];
  title: string;
  value: string;
}) {
  return (
    <span className={`${RAIL_CHIP_CLASS} shrink-0 tabular-nums`} title={title}>
      <Icon name={icon} className="size-3 shrink-0" />
      {value}
    </span>
  );
}

function LabelChip({ label }: { label: Label }) {
  return (
    <span className={`${RAIL_CHIP_CLASS} max-w-32`}>
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: label.color }}
      />
      <span className="truncate">{label.name}</span>
    </span>
  );
}

function LabelChipRow({
  labels,
  maxVisible,
}: {
  labels: readonly Label[];
  maxVisible: number;
}) {
  const { visible, hidden } = partitionLabels(labels, maxVisible);
  return (
    <>
      {visible.map((label) => (
        <LabelChip key={label.id} label={label} />
      ))}
      {hidden.length > 0 ? (
        <span
          title={hidden.map((label) => label.name).join(", ")}
          className={`${RAIL_CHIP_CLASS} tabular-nums`}
        >
          +{hidden.length}
        </span>
      ) : null}
    </>
  );
}

/**
 * Row label chips, capped so rows keep a bounded metadata width: two chips in
 * regular containers, one in narrow ones (both variants render; container
 * queries on the list body pick which is displayed). Overflow collapses into a
 * "+N" chip whose tooltip lists the hidden names.
 */
function LabelChips({
  labels,
}: {
  labels: readonly Label[];
}) {
  return (
    <>
      <span className="hidden items-center gap-1.5 @xl:flex">
        <LabelChipRow labels={labels} maxVisible={2} />
      </span>
      <span className="flex items-center gap-1.5 @xl:hidden">
        <LabelChipRow labels={labels} maxVisible={1} />
      </span>
    </>
  );
}

/**
 * Single em-dash placeholder for an enabled-but-empty field (the "show empty"
 * mode). One uniform glyph across fields — the row keeps its slots aligned
 * without inventing a distinct empty form per field.
 */
function FieldPlaceholder({ field }: { field: RowField }) {
  return (
    <span
      title={`${ROW_FIELD_LABELS[field]}: —`}
      className="flex items-center text-subtle-foreground/60"
    >
      —
    </span>
  );
}

/** Renders one planned rail cell's value; placeholders are handled by callers. */
function RailValue({
  field,
  task,
  meta,
  project,
  labels,
}: {
  field: RowField;
  task: Task;
  meta: TaskRowMeta | undefined;
  project: Project | undefined;
  labels: readonly Label[];
}) {
  switch (field) {
    case "priority":
      return <PriorityChip priority={task.priority} />;
    case "active":
      return <ActiveChip threads={meta?.activeThreads ?? []} />;
    case "type":
      return task.type !== null ? <TypeChip type={task.type} /> : null;
    case "estimate":
      return task.estimate !== null ? (
        <EstimateChip estimate={task.estimate} />
      ) : null;
    case "labels":
      return <LabelChips labels={labels} />;
    case "tokens":
      return (
        <TokensChip planTokens={task.planTokens} factTokens={task.factTokens} />
      );
    case "dueDate":
      return task.dueDate !== null ? (
        <DateChip
          icon="Clock"
          title={`Due ${formatDueDate(task.dueDate)}`}
          value={formatDueDate(task.dueDate)}
        />
      ) : null;
    case "project":
      return project !== undefined ? (
        <span
          aria-hidden
          title={project.name}
          className="size-2.5 shrink-0 rounded-sm"
          style={{ backgroundColor: project.color }}
        />
      ) : null;
    case "createdAt":
      return (
        <DateChip
          icon="Calendar"
          title={`Created ${formatTimestamp(task.createdAt)}`}
          value={formatTimestamp(task.createdAt)}
        />
      );
    case "updatedAt":
      return (
        <DateChip
          icon="Edit"
          title={`Edited ${formatTimestamp(task.updatedAt)}`}
          value={formatTimestamp(task.updatedAt)}
        />
      );
  }
}

export interface TaskRowProps {
  /** Task with any pending optimistic edit already applied. */
  task: Task;
  /** 0 for a top-level task; 1 indents the title to read as nested under the
   * subtask's parent row directly above it. */
  depth?: 0 | 1;
  meta: TaskRowMeta | undefined;
  project: Project | undefined;
  showProject: boolean;
  labelsById: Map<string, Label>;
  /** Labels belonging to this task's project, for the context menu. */
  projectLabels: readonly Label[];
  /** Which rail fields to draw, in order, and how to treat empties. */
  fieldConfig: FieldDisplayConfig;
  onEdit: EditFn;
  onOpen: () => void;
  /** A mutation for this row is in flight. */
  pending: boolean;
}

/**
 * One task-list row. Primary navigation is a stretched overlay button so the
 * whole row opens the task, while the inline status/priority pickers sit above
 * it (z-10) and stay independently clickable — so editing never triggers an
 * accidental open. A focused row also opens the pickers with `S`/`P`, and
 * right-click (or the context-menu key / touch long-press) opens the property
 * menu. The trailing rail is drawn from the client-local field config (order +
 * visibility + show-empty); priority and key stay leading and unmanaged.
 */
export function TaskRow({
  task,
  depth = 0,
  meta,
  project,
  showProject,
  labelsById,
  projectLabels,
  fieldConfig,
  onEdit,
  onOpen,
  pending,
}: TaskRowProps) {
  const [openMenu, setOpenMenu] = useState<"status" | "priority" | null>(null);
  const labels = useMemo(
    () => task.labelIds.flatMap((id) => labelsById.get(id) ?? []),
    [task.labelIds, labelsById],
  );
  const cells = useMemo(
    () =>
      planRowFields(fieldConfig, task, {
        activeCount: meta?.activeThreads.length ?? 0,
        showProject,
        hasProject: project !== undefined,
      }),
    [fieldConfig, task, meta, showProject, project],
  );

  return (
    <TaskContextMenu task={task} onEdit={onEdit} projectLabels={projectLabels}>
      <div
        data-task-key={task.key}
        aria-busy={pending || undefined}
        className={cn(
          // Narrow containers get a two-line hierarchy: status + full-width
          // title on top, then priority, key, and the metadata rail below.
          // From @md up the same children lay out as the classic single flex
          // row (the grid placement classes are inert in flex), so desktop
          // keeps its exact 34px rows.
          "relative grid w-full grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 border-b border-border-hairline px-3.5 py-1.5 text-left transition-opacity hover:bg-state-hover",
          "@md:flex @md:h-[34px] @md:py-0",
          pending && "opacity-70",
        )}
      >
        <button
          type="button"
          aria-label={`Open ${task.key}: ${task.title}`}
          onClick={onOpen}
          onKeyDown={(event) => {
            if (!isBareKey(event)) return;
            const key = event.key.toLowerCase();
            if (key === "s") {
              event.preventDefault();
              setOpenMenu("status");
            } else if (key === "p") {
              event.preventDefault();
              setOpenMenu("priority");
            }
          }}
          className="absolute inset-0 rounded-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        />
        <PriorityEditor
          task={task}
          onEdit={onEdit}
          open={openMenu === "priority"}
          onOpenChange={(next) => setOpenMenu(next ? "priority" : null)}
          className="col-start-1 row-start-2"
        />
        <span className="col-start-2 row-start-2 min-w-0 truncate text-xs tabular-nums text-subtle-foreground @max-md:max-w-32 @md:w-14 @md:shrink-0">
          {task.key}
        </span>
        <StatusEditor
          task={task}
          onEdit={onEdit}
          open={openMenu === "status"}
          onOpenChange={(next) => setOpenMenu(next ? "status" : null)}
          className="col-start-1 row-start-1"
        />
        <span className="col-start-2 col-span-2 row-start-1 flex min-w-0 items-center gap-1 truncate text-sm @md:flex-1">
          {depth === 1 ? (
            <span aria-hidden className="shrink-0 text-subtle-foreground">
              ∟
            </span>
          ) : null}
          <span className="min-w-0 truncate">{task.title}</span>
        </span>
        <span className="col-start-3 row-start-2 flex min-w-0 items-center gap-1.5 justify-self-end text-xs text-subtle-foreground @max-md:overflow-hidden @md:shrink-0">
          {cells.map((cell) =>
            cell.mode === "placeholder" ? (
              <FieldPlaceholder key={cell.field} field={cell.field} />
            ) : (
              <RailValue
                key={cell.field}
                field={cell.field}
                task={task}
                meta={meta}
                project={project}
                labels={labels}
              />
            ),
          )}
        </span>
      </div>
    </TaskContextMenu>
  );
}
