import { useMemo, useState } from "react";
import type { Project, Task } from "../../shared/contract.js";
import { useTasksRpc } from "../../client/data.js";
import { useOpenTask } from "../../client/task-opening.js";
import { sectionFields, type SectionField } from "../../shared/section-fields.js";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { useListTasks } from "../common/data.js";
import { formatDateValue } from "../common/date-display.js";
import { listFieldScope, taskOpeningOf, useFieldDisplay } from "../common/row-field-preference.js";
import { AddFieldPopover, FIELD_TYPE_ICONS, OptionChips } from "../common/section-field.js";
import { surfaceOf } from "../common/view-state.js";
import type { ListPreferenceScope } from "../common/list-preference.js";
import { DetailToasts, useDetailToasts } from "../detail/toast.js";
import { pinOffsets } from "./columns.js";
import { TitleCell } from "./cells.js";
import { NewTaskRow } from "./new-task-row.js";
import { TableHeader, type HeaderActions, type HeaderColumnState } from "./header.js";
import {
  allSectionColumns,
  DEFAULT_SECTION_FORMAT,
  fieldNameOf,
  isChecked,
  movedSectionLayout,
  numberOf,
  sectionColumnWidth,
  sectionValue,
  sortedRecords,
  useSectionLayout,
  visibleSectionColumns,
  withToggled,
  withWidth,
  type SectionColumn,
  type SectionLayout,
} from "./section-layout.js";

/**
 * A section's table: the same table as the task board's — a menu on every
 * header, widths dragged at the edge, columns dragged into place and pinned —
 * over the section's own columns: the title, the two dates the database keeps
 * and a column per field. The "+" at the end of the header adds a field with
 * its type (docs/specs/BBPL-901-tasks-zapis-tablicy-otkryvaetsya-kasimovym.md).
 */

const NO_FILTERS = { statuses: [], priorities: [], labelIds: null } as const;
const OWN_LABELS: Partial<Record<SectionColumn, string>> = { title: "Title", description: "Description", createdAt: "Created", updatedAt: "Edited" };

/** One value of a record, drawn the way its column's type reads. */
function SectionCell({ task, column, field, layout, now }: { task: Task; column: SectionColumn; field: SectionField | undefined; layout: SectionLayout; now: Date }) {
  const value = sectionValue(task, column);
  const format = layout.formats[column] ?? DEFAULT_SECTION_FORMAT;
  if (column === "createdAt" || column === "updatedAt") {
    return <span className="truncate tabular-nums">{formatDateValue({ kind: "moment", iso: value }, format, now)}</span>;
  }
  if (value === "" || field === undefined) return <span className="truncate">{value}</span>;
  switch (field.type) {
    case "date":
      return <span className="truncate tabular-nums">{formatDateValue({ kind: "plan", value }, format, now) || value}</span>;
    case "number":
      return <span className={cn("w-full truncate text-right tabular-nums", numberOf(value) === null && "text-subtle-foreground")}>{value}</span>;
    case "checkbox":
      return isChecked(value) ? <Icon name="CircleCheck" aria-label="Yes" className="size-3.5 text-foreground" /> : <span aria-label="No" />;
    case "url":
      return (
        <a href={value} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="truncate underline underline-offset-2 hover:text-foreground">
          {value}
        </a>
      );
    case "select":
    case "tags":
      return <OptionChips field={field} value={value} />;
    case "text":
      return <span className="truncate">{value}</span>;
  }
}

/** The section's columns with a switch each, for the Display panel: a hidden column comes back here. */
export function SectionColumnToggles({ section }: { section: Project }) {
  const [layout, setLayout] = useSectionLayout(section.id);
  const records = useListTasks(section.id, null, NO_FILTERS, undefined);
  const fields = sectionFields(section.database?.fields ?? [], records.data ?? []);
  const hidden = new Set(layout.hidden);
  return (
    <div role="list" aria-label="Columns" className="flex flex-col">
      {allSectionColumns(fields, layout)
        .filter((column) => column !== "title")
        .map((column) => (
          <button
            key={column}
            type="button"
            role="listitem"
            aria-pressed={!hidden.has(column)}
            onClick={() => setLayout((current) => ({ ...current, hidden: withToggled(current.hidden, column) }))}
            className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-sm hover:bg-state-hover"
          >
            <span className="flex-1 truncate">{OWN_LABELS[column] ?? fieldNameOf(column)}</span>
            <span className="flex size-4 shrink-0 items-center justify-center">{hidden.has(column) ? null : <Icon name="Check" className="size-3.5" />}</span>
          </button>
        ))}
    </div>
  );
}

export function SectionTable({ scope, thread, section }: { scope: ListPreferenceScope; thread?: string; section: Project }) {
  const { projectId, listScope } = surfaceOf(scope);
  const openTask = useOpenTask(taskOpeningOf(useFieldDisplay(listFieldScope(projectId, listScope))));
  const rpc = useTasksRpc();
  const { toasts, push, dismiss } = useDetailToasts();
  const [layout, setLayout] = useSectionLayout(section.id);
  const records = useListTasks(section.id, listScope, NO_FILTERS, thread);
  const fields = useMemo(() => sectionFields(section.database?.fields ?? [], records.data ?? []), [section.database?.fields, records.data]);
  const fieldsByColumn = useMemo(() => new Map(fields.map((field) => [`field:${field.name}`, field])), [fields]);
  const rows = useMemo(() => sortedRecords(records.data ?? [], layout.sort, fields), [records.data, layout.sort, fields]);
  const columns = visibleSectionColumns(fields, layout);
  const widths = Object.fromEntries(columns.map((column) => [column, sectionColumnWidth(layout, column)])) as Record<SectionColumn, number>;
  const { offsets, edge } = pinOffsets(columns, layout.pinned, widths);
  const pinned = new Set(layout.pinned);
  const gridTemplate = columns.map((column) => `${widths[column]}px`).join(" ");
  const totalWidth = columns.reduce((sum, column) => sum + widths[column], 0);
  // Relative dates count from the render's own moment, the same for every row.
  const now = new Date();
  const [creating, setCreating] = useState(false);

  const createRecord = () => {
    setCreating(true);
    rpc
      .call("createTask", { projectId: section.id, title: "Untitled" })
      .then(
        (result) => (result.ok ? openTask(result.task.key ?? result.task.id) : push("error", result.error.message)),
        (error: unknown) => push("error", error instanceof Error ? error.message : String(error)),
      )
      .finally(() => setCreating(false));
  };

  const headerColumns: HeaderColumnState<SectionColumn>[] = columns.map((column) => {
    const field = fieldsByColumn.get(column);
    const dated = column === "createdAt" || column === "updatedAt" || field?.type === "date";
    return {
      column,
      label: OWN_LABELS[column] ?? fieldNameOf(column) ?? column,
      ...(field === undefined ? {} : { typeIcon: FIELD_TYPE_ICONS[field.type] }),
      width: widths[column],
      pinned: pinned.has(column),
      offset: offsets[column],
      edge: column === edge,
      sort: layout.sort?.column === column ? layout.sort.direction : null,
      sortable: true,
      widthChanged: layout.widths[column] !== undefined,
      dateFormat: dated ? (layout.formats[column] ?? DEFAULT_SECTION_FORMAT) : null,
      icon: null,
    };
  });

  const actions: HeaderActions<SectionColumn> = {
    onSort: (column, direction) => setLayout((current) => ({ ...current, sort: direction === null ? null : { column, direction } })),
    onPin: (column, pin) =>
      setLayout((current) => ({ ...current, pinned: pin ? [...current.pinned, column] : current.pinned.filter((entry) => entry !== column) })),
    onHide: (column) => setLayout((current) => ({ ...current, hidden: withToggled(current.hidden, column) })),
    onMove: (column, toIndex) => setLayout((current) => movedSectionLayout(fields, current, column, toIndex)),
    onResize: (column, width) => setLayout((current) => withWidth(current, column, width)),
    onDisplay: (column, patch) =>
      setLayout((current) => (patch.format === undefined ? current : { ...current, formats: { ...current.formats, [column]: patch.format } })),
  };

  const body =
    records.data === undefined ? (
      <div className="p-6 text-sm text-muted-foreground">{records.error ?? "Loading…"}</div>
    ) : (
      <div style={{ minWidth: `${totalWidth + 40}px` }}>
        <div className="sticky top-0 z-20 bg-background">
          <TableHeader
            columns={headerColumns}
            actions={actions}
            trailing={
              <div className="flex min-w-10 flex-1 items-center border-b border-border-hairline bg-background px-1">
                <AddFieldPopover
                  sectionId={section.id}
                  declared={section.database?.fields ?? []}
                  trigger={
                    <button
                      type="button"
                      aria-label="Add a property"
                      className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground"
                    >
                      <Icon name="Plus" className="size-3.5" />
                    </button>
                  }
                />
              </div>
            }
          />
        </div>
        {rows.map((task) => (
          <div
            key={task.id}
            role="row"
            data-task-key={task.key}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("button, a")) return;
              openTask(task.key);
            }}
            className="group grid h-[34px] cursor-pointer items-stretch border-b border-border-hairline text-sm hover:bg-state-hover"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            {columns.map((column) => (
              <div
                key={column}
                data-column={column}
                className={cn(
                  "flex min-w-0 items-center overflow-hidden px-2",
                  column !== "title" && "text-muted-foreground",
                  pinned.has(column) &&
                    "sticky z-[1] bg-background before:pointer-events-none before:absolute before:inset-0 before:-z-10 group-hover:before:bg-state-hover",
                  column === edge && "border-r border-border-hairline",
                )}
                style={pinned.has(column) ? { left: `${offsets[column] ?? 0}px` } : undefined}
              >
                {column === "title" ? (
                  <TitleCell task={task} depth={0} childCount={0} collapsed={false} onToggle={() => {}} onOpen={() => openTask(task.key)} />
                ) : (
                  <SectionCell task={task} column={column} field={fieldsByColumn.get(column)} layout={layout} now={now} />
                )}
              </div>
            ))}
          </div>
        ))}
        <NewTaskRow label="New record" text="New record" busy={creating} onOpen={createRecord} />
      </div>
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        {body}
      </div>
      <DetailToasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
