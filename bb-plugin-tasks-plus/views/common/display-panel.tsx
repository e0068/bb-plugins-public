import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  moveField,
  resetFieldDisplay,
  ROW_FIELD_LABELS,
  setSubtaskScope,
  subtaskScopeOf,
  setShowEmpty,
  setTaskOpening,
  taskOpeningOf,
  toggleFieldVisible,
  useFieldDisplay,
  type FieldScope,
  type RowField,
} from "./row-field-preference.js";
import {
  BOARD_GRID_COLUMN_COUNTS,
  BOARD_GROUP_BYS,
  BOARD_GROUP_PROPERTIES,
  CHART_UNITS,
  DATE_DENSITIES,
  DATE_PLACES,
  GANTT_MODES,
  MAX_CARD_CHART_PERIOD,
  SUBTASK_SCOPES,
  TODAY_PLACES,
  type BoardGridColumns,
  type BoardGroupBy,
  type ChartUnit,
  type DateDensity,
  type DatePlace,
  type GanttMode,
  type SubtaskScope,
  type TodayPlace,
} from "../../shared/enums.js";
import { useTasksQuery } from "../../client/data.js";
import type { TaskViewMode } from "../../client/routes.js";
import type { ViewTarget } from "./view-state.js";
import type { ListPreferenceScope } from "./list-preference.js";
import { scopeBoardKey, loadBoardLayout, setBoardLayout, useBoardLayout, type BoardKey } from "../board/board-preference.js";
import { parseChartPeriod, setChartPreference, useChartPreference } from "../board/chart-preference.js";
import {
  DESCRIPTION_SIZES,
  setCardText,
  TITLE_SIZES,
  useCardText,
  type DescriptionSize,
  type TitleSize,
} from "../board/card-text-preference.js";
import { fillsWidth, gridColumnsOf, groupKeys, withColumnOrder, withFillWidth, withHiddenToggled, type BoardLayout } from "../board/grouping.js";
import { fetchScopeBoard } from "../board/scope-data.js";
import { setTableSettings, useTableSettings } from "../table/table-preference.js";
import { ReorderList } from "./reorder-list.js";

/** A visible column's pin state and the way to flip it — the table only; a board's field list carries none. */
interface PinControl {
  pinned: readonly RowField[];
  onTogglePin: (field: RowField) => void;
}

function FieldList({ scope, pin }: { scope: FieldScope; pin?: PinControl }) {
  const config = useFieldDisplay(scope);
  const rows = config.fields.map((entry) => ({
    id: entry.field,
    label: ROW_FIELD_LABELS[entry.field],
    visible: entry.field === "title" || entry.visible,
    // The card always draws its title: it only moves, so it has no check.
    locked: entry.field === "title",
  }));
  return (
    <ReorderList
      label="Fields"
      rows={rows}
      onToggle={(field) => toggleFieldVisible(scope, field as RowField)}
      onMove={(from, to) => moveField(scope, from, to)}
      trailing={(row) => {
        if (!pin || !row.visible) return null;
        const field = row.id as RowField;
        const pinned = pin.pinned.includes(field);
        return (
          <button
            type="button"
            aria-label={`${pinned ? "Unpin" : "Pin"} ${row.label}`}
            aria-pressed={pinned}
            onClick={() => pin.onTogglePin(field)}
            className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-state-hover hover:text-foreground"
          >
            <Icon name="Pin" className={cn("size-3.5", !pinned && "opacity-40")} />
          </button>
        );
      }}
    />
  );
}

const SUBTASK_SCOPE_LABELS: Record<SubtaskScope, string> = {
  all: "All sub-tasks",
  open: "Open sub-tasks",
  "open-children": "Open, first level",
};

function ToggleRow({
  checked,
  label,
  onToggle,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={onToggle}
      className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-sm hover:bg-state-hover"
    >
      <span className="flex-1">{label}</span>
      <span className="flex size-4 shrink-0 items-center justify-center">
        {checked ? <Icon name="Check" className="size-3.5" /> : null}
      </span>
    </button>
  );
}

const GROUP_LABELS: Record<BoardGroupBy, string> = {
  status: "Status",
  priority: "Priority",
  type: "Type",
  estimate: "Estimate",
  assignee: "Assignee",
  label: "Label",
  none: "No grouping",
};

const GANTT_MODE_LABELS: Record<GanttMode, string> = { plan: "Planned dates", fact: "Actual statuses", both: "Planned and actual" };

const TODAY_PLACE_LABELS: Record<TodayPlace, string> = { left: "Left", center: "Center", right: "Right" };

const CHART_UNIT_LABELS: Record<ChartUnit, string> = { days: "Days", hours: "Hours", minutes: "Minutes" };

const DATE_PLACE_LABELS: Record<DatePlace, string> = { off: "Off", charts: "Under each chart", card: "Along the card's bottom" };

const DATE_DENSITY_LABELS: Record<DateDensity, string> = { few: "Few", some: "Some", many: "Many" };

/** One stretch of the panel under its heading; stretches part by air, not rules. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <h3 className="px-1.5 pb-1 text-xs text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** One of several exclusive choices, checked like the rows around it. */
function ChoiceRows<T extends string>({
  label,
  options,
  labels,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label}>
      {options.map((option) => (
        <ToggleRow key={option} checked={value === option} label={labels[option]} onToggle={() => onChange(option)} />
      ))}
    </div>
  );
}

/** The columns of the grouped property: drag a row to reorder, the eye hides a column. */
function GroupColumns({ scope, layout, onChange }: {
  scope: ListPreferenceScope;
  layout: BoardLayout;
  onChange: (grouping: BoardLayout["grouping"]) => void;
}) {
  const data = useTasksQuery((rpc) => fetchScopeBoard(rpc, scope), ["tasks:changed", "projects:changed"], [scope]).data;
  const rows = groupKeys(layout.grouping, data?.tasks ?? [], data?.labels ?? []);
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const drop = (target: string) => {
    if (dragged === null || dragged === target) return;
    const order = rows.map((row) => row.key).filter((key) => key !== dragged);
    order.splice(order.indexOf(target), 0, dragged);
    onChange(withColumnOrder(layout.grouping, order));
  };
  return (
    <div role="list" aria-label="Columns">
      {rows.map((row) => (
        <div
          key={row.key}
          role="listitem"
          draggable
          data-column-row={row.key}
          onDragStart={() => setDragged(row.key)}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(row.key);
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(event) => {
            event.preventDefault();
            drop(row.key);
            setDragged(null);
            setOver(null);
          }}
          onDragEnd={() => {
            setDragged(null);
            setOver(null);
          }}
          className={cn(
            "flex h-7 items-center gap-1 rounded-sm text-sm hover:bg-state-hover",
            over === row.key && dragged !== row.key && "shadow-[inset_0_2px_0_var(--primary)]",
          )}
        >
          <span className="flex size-6 shrink-0 cursor-grab items-center justify-center text-subtle-foreground">
            <Icon name="DragDropVertical" className="size-3.5" />
          </span>
          <span className={cn("min-w-0 flex-1 truncate px-1.5", row.hidden && "text-muted-foreground")}>{row.label}</span>
          <button
            type="button"
            aria-label={`${row.hidden ? "Show" : "Hide"} ${row.label} column`}
            aria-pressed={!row.hidden}
            className="mr-1 flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-state-active hover:text-foreground"
            onClick={() => onChange(withHiddenToggled(layout.grouping, row.key))}
          >
            <Icon name={row.hidden ? "EyeOff" : "Eye"} className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

const GRID_COLUMN_CHOICES: readonly BoardGridColumns[] = ["auto", ...BOARD_GRID_COLUMN_COUNTS];

/** How many columns the ungrouped grid lays its cards out in. */
function GridColumnsPicker({ value, onChange }: {
  value: BoardGridColumns;
  onChange: (value: BoardGridColumns) => void;
}) {
  return (
    <div role="group" aria-label="Columns" className="flex gap-0.5 px-1">
      {GRID_COLUMN_CHOICES.map((choice) => (
        <Button
          key={choice}
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={value === choice}
          aria-label={choice === "auto" ? "Auto columns" : `${choice} ${choice === 1 ? "column" : "columns"}`}
          className="h-7 min-w-7 flex-1 px-1.5 tabular-nums"
          onClick={() => onChange(choice)}
        >
          {choice === "auto" ? "Auto" : choice}
        </Button>
      ))}
    </div>
  );
}

/** How the board lays its cards out: the property it groups by, and its columns. */
function GroupingSection({ scope, boardKeyOf }: { scope: ListPreferenceScope; boardKeyOf: BoardKey }) {
  const layout = useBoardLayout(boardKeyOf);
  const grouping = layout.grouping;
  const onChange = (next: BoardLayout["grouping"]) => setBoardLayout(boardKeyOf, { ...loadBoardLayout(boardKeyOf), grouping: next });
  return (
    <>
      <Section title="Group by">
        <ChoiceRows
          label="Group by"
          options={[...BOARD_GROUP_PROPERTIES, "none" as const]}
          labels={GROUP_LABELS}
          value={grouping.groupBy}
          onChange={(groupBy) => onChange({ ...grouping, groupBy })}
        />
      </Section>
      {grouping.groupBy === "none" ? (
        <Section title="Columns">
          <GridColumnsPicker value={gridColumnsOf(grouping)} onChange={(gridColumns) => onChange({ ...grouping, gridColumns })} />
        </Section>
      ) : (
        <Section title="Columns — drag to reorder">
          <GroupColumns scope={scope} layout={layout} onChange={onChange} />
          <div role="group" aria-label="Board columns">
            <ToggleRow
              checked={grouping.hideEmpty}
              label="Hide empty columns"
              onToggle={() => onChange({ ...grouping, hideEmpty: !grouping.hideEmpty })}
            />
            <ToggleRow
              checked={fillsWidth(grouping)}
              label="Fill width"
              onToggle={() => onChange(withFillWidth(grouping, !fillsWidth(grouping)))}
            />
          </div>
        </Section>
      )}
    </>
  );
}

/** How the table lays its rows out: the property it groups by — the same choices a board's columns offer, minus their reordering and hiding. */
function TableGroupSection({ scope }: { scope: ListPreferenceScope }) {
  const table = useTableSettings(scope);
  return (
    <Section title="Group by">
      <ChoiceRows
        label="Group by"
        options={BOARD_GROUP_BYS}
        labels={GROUP_LABELS}
        value={table.groupBy}
        onChange={(groupBy) => setTableSettings(scope, { groupBy })}
      />
    </Section>
  );
}

/**
 * How many of the unit the card charts cover, typed in; 0 is all time. A
 * draft that is not a count yet — empty, negative, too long — stays in the
 * field and changes nothing until it is one.
 */
function PeriodInput({ value, unit, onChange }: { value: number; unit: ChartUnit; onChange: (count: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [shown, setShown] = useState(value);
  // Another tab or a reset moved the stored value: the field follows it.
  if (shown !== value) {
    setShown(value);
    setDraft(String(value));
  }
  return (
    <Input
      type="number"
      inputMode="numeric"
      min={0}
      max={MAX_CARD_CHART_PERIOD}
      aria-label={`${CHART_UNIT_LABELS[unit]} the card charts cover`}
      value={draft}
      className="h-7 w-16 px-2 text-sm tabular-nums"
      onChange={(event) => {
        setDraft(event.target.value);
        const count = event.target.value.trim() === "" ? null : parseChartPeriod(Number(event.target.value));
        if (count !== null) onChange(count);
      }}
      onBlur={() => setDraft(String(value))}
    />
  );
}

/**
 * What the cards' burndown and Gantt cover — so many days, hours or minutes
 * — where today stands in it — right to look back over the past, center to
 * watch the present, left to plan ahead — what the Gantt draws, and where
 * and how thickly the dates are written: one choice for the whole board.
 */
function ChartsSection({ boardKeyOf }: { boardKeyOf: BoardKey }) {
  const charts = useChartPreference(boardKeyOf);
  return (
    <>
      <Section title="Card charts cover">
        <div role="group" aria-label="Card charts cover" className="flex items-center gap-1 pl-1.5">
          <PeriodInput value={charts.period} unit={charts.unit} onChange={(period) => setChartPreference(boardKeyOf, { ...charts, period })} />
          <ButtonChoice
            groupLabel="Period unit"
            options={CHART_UNITS}
            labels={CHART_UNIT_LABELS}
            value={charts.unit}
            onChange={(unit) => setChartPreference(boardKeyOf, { ...charts, unit })}
          />
        </div>
        <p className="px-1.5 pt-1 text-xs text-subtle-foreground">0 — all time</p>
        <div className="pt-2">
          <SizePicker
            label="Today"
            groupLabel="Today"
            options={TODAY_PLACES}
            labels={TODAY_PLACE_LABELS}
            value={charts.today}
            onChange={(today) => setChartPreference(boardKeyOf, { ...charts, today })}
          />
        </div>
      </Section>
      <Section title="Gantt shows">
        <ChoiceRows
          label="Gantt shows"
          options={GANTT_MODES}
          labels={GANTT_MODE_LABELS}
          value={charts.ganttMode}
          onChange={(ganttMode) => setChartPreference(boardKeyOf, { ...charts, ganttMode })}
        />
      </Section>
      <Section title="Card chart dates">
        <ChoiceRows
          label="Card chart dates"
          options={DATE_PLACES}
          labels={DATE_PLACE_LABELS}
          value={charts.dates}
          onChange={(dates) => setChartPreference(boardKeyOf, { ...charts, dates })}
        />
        <div className="pt-2">
          <SizePicker
            label="Density"
            groupLabel="Date density"
            options={DATE_DENSITIES}
            labels={DATE_DENSITY_LABELS}
            value={charts.dateDensity}
            onChange={(dateDensity) => setChartPreference(boardKeyOf, { ...charts, dateDensity })}
          />
        </div>
      </Section>
    </>
  );
}

const TITLE_SIZE_LABELS: Record<TitleSize, string> = { s: "S", m: "M", l: "L" };
const DESCRIPTION_SIZE_LABELS: Record<DescriptionSize, string> = { xs: "XS", s: "S", m: "M" };

/** One choice picked from a few, as a row of buttons like the grid's column count. */
function ButtonChoice<T extends string>({ groupLabel, options, labels, value, onChange }: {
  /** The buttons' group as a screen reader names it. */
  groupLabel: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={groupLabel} className="flex gap-0.5 pr-1">
      {options.map((option) => (
        <Button
          key={option}
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={value === option}
          className="h-7 min-w-9 px-1.5"
          onClick={() => onChange(option)}
        >
          {labels[option]}
        </Button>
      ))}
    </div>
  );
}

/** A named choice of a few, its buttons on the right of its name. */
function SizePicker<T extends string>({ label, groupLabel = `${label} size`, ...choice }: {
  label: string;
  /** The buttons' group as a screen reader names it; a size picker by default. */
  groupLabel?: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-2 pl-1.5">
      <span className="flex-1 text-sm">{label}</span>
      <ButtonChoice groupLabel={groupLabel} {...choice} />
    </div>
  );
}

/** The type sizes of the board's cards: the title's, the description's and the sub-task list's. */
function CardTextSection({ boardKeyOf }: { boardKeyOf: BoardKey }) {
  const text = useCardText(boardKeyOf);
  return (
    <Section title="Card text">
      <SizePicker
        label="Title"
        options={TITLE_SIZES}
        labels={TITLE_SIZE_LABELS}
        value={text.title}
        onChange={(title) => setCardText(boardKeyOf, { ...text, title })}
      />
      <SizePicker
        label="Description"
        options={DESCRIPTION_SIZES}
        labels={DESCRIPTION_SIZE_LABELS}
        value={text.description}
        onChange={(description) => setCardText(boardKeyOf, { ...text, description })}
      />
      <SizePicker
        label="Sub-tasks"
        options={DESCRIPTION_SIZES}
        labels={DESCRIPTION_SIZE_LABELS}
        value={text.subtasks}
        onChange={(subtasks) => setCardText(boardKeyOf, { ...text, subtasks })}
      />
    </Section>
  );
}

const LAYOUT_LABELS: Record<TaskViewMode, string> = { table: "Table", board: "Board" };

/** Table or Board, for any screen: the two ways its tasks lie. */
function LayoutSwitch({ value, onChange }: { value: TaskViewMode; onChange: (mode: TaskViewMode) => void }) {
  return (
    <div role="group" aria-label="Layout" className="mx-1.5 flex rounded-md bg-muted p-0.5">
      {(["table", "board"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
          className={cn(
            "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm text-sm",
            value === mode ? "bg-background text-foreground shadow-2xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon name={mode === "table" ? "ListView" : "Columns2"} className="size-3.5" />
          {LAYOUT_LABELS[mode]}
        </button>
      ))}
    </div>
  );
}

export interface DisplayPanelProps {
  target: ViewTarget;
  /** The screen's or the view's Table/Board switch; absent on a task, Manage or Analytics — Display does not open there. */
  layout?: { value: TaskViewMode; onChange: (mode: TaskViewMode) => void };
  onClose: () => void;
}

/**
 * Everything about how a table or board looks that is not a filter or a
 * sort: Table or Board, the board's grouping (or the table's), the fields
 * in their order, the sub-task list, the card charts, empty values, where a
 * task opens. Backed by the same stores as the surfaces, so a change here
 * shows at once.
 */
export function DisplayPanel({ target, layout, onClose }: DisplayPanelProps) {
  const fieldScope: FieldScope = target.layout === "board" ? scopeBoardKey(target.scope, target.view?.id ?? null) : target.scope;
  const config = useFieldDisplay(fieldScope);
  const taskOpening = taskOpeningOf(config);
  const table = useTableSettings(target.scope);
  return (
    <aside aria-label="Display" className="flex h-full min-h-0 w-full flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center justify-between pr-2 pl-4 text-sm font-medium">
        Display
        <Button type="button" variant="ghost" size="icon" aria-label="Close display settings" className="size-7 text-muted-foreground" onClick={onClose}>
          <Icon name="X" className="size-3.5" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2.5 pb-4">
        {layout ? (
          <Section title="Layout">
            <LayoutSwitch value={layout.value} onChange={layout.onChange} />
          </Section>
        ) : null}
        {target.layout === "board" ? <GroupingSection scope={target.scope} boardKeyOf={fieldScope as BoardKey} /> : null}
        {target.layout === "table" ? <TableGroupSection scope={target.scope} /> : null}
        <Section title={target.layout === "table" ? "Columns — drag to reorder" : "Fields — drag to reorder"}>
          <FieldList
            scope={fieldScope}
            pin={
              target.layout === "table"
                ? { pinned: table.pinned, onTogglePin: (field) => setTableSettings(target.scope, { pinned: togglePinned(table.pinned, field) }) }
                : undefined
            }
          />
        </Section>
        {target.layout === "board" ? (
          <>
            <Section title="Sub-task list">
              <ChoiceRows
                label="Sub-task list"
                options={SUBTASK_SCOPES}
                labels={SUBTASK_SCOPE_LABELS}
                value={subtaskScopeOf(config)}
                onChange={(subtaskScope) => setSubtaskScope(fieldScope, subtaskScope)}
              />
            </Section>
            <CardTextSection boardKeyOf={fieldScope as BoardKey} />
            <ChartsSection boardKeyOf={fieldScope as BoardKey} />
          </>
        ) : null}
        <Section title="Other">
          <ToggleRow checked={config.showEmpty} label="Show empty values" onToggle={() => setShowEmpty(fieldScope, !config.showEmpty)} />
          <ToggleRow
            checked={taskOpening === "side-panel"}
            label="Open in side panel"
            onToggle={() => setTaskOpening(fieldScope, taskOpening === "side-panel" ? "main" : "side-panel")}
          />
          <button
            type="button"
            onClick={() => resetFieldDisplay(fieldScope)}
            className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground"
          >
            <Icon name="RotateCcw" className="size-3.5" />
            Reset to default
          </button>
        </Section>
      </div>
    </aside>
  );
}

/** A column's pinned set with `field` flipped — appended when newly pinned, dropped when it was. */
function togglePinned(pinned: readonly RowField[], field: RowField): RowField[] {
  return pinned.includes(field) ? pinned.filter((entry) => entry !== field) : [...pinned, field];
}
