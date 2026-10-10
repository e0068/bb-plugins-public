// The settings of one analytics tile, in a side panel laid out like Display:
// Chart (type, title), Data (window, axes, measure, breakdown, figures, bars),
// Selection (switch, the filter by conditions, sort, rows) and Display (legend,
// axis labels, grid, trend). Only what the type reads is shown
// (TILE_USES). Every change goes out at once — the tile on the screen is
// drawn from the draft — and Save or Cancel ends the edit.
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Icon, type IconName } from "../../components/ui/icon";
import { Input } from "../../components/ui/input";
import { Segments } from "../../components/ui/segments";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "../../components/ui/select";
import { CONTENTS_SHARE, FIGURES, FIELD_METRICS, TILE_TABLE_FIELDS, TILE_TABLE_ROWS, TILE_TITLE_MAX, readsSetting, tileTable, type TileTable, type Figure, type TileSetting, type TileType, type TileWindow, type WindowUnit, type YMetric, WINDOW_COUNT_MAX, WINDOW_UNITS } from "../../shared/analytics-tile.js";
import type { Tile } from "../../shared/contract.js";
import { FIELD_FILTER_KINDS, NUMBER_FIELDS, QUERY_FIELDS, type NumberField, type QueryField } from "../../shared/enums.js";
import { cn } from "../../lib/utils";
import { ReorderList } from "../common/reorder-list.js";
import { ROW_FIELD_LABELS } from "../common/row-field-preference.js";
import type { SuggestionScope } from "../../shared/tile-conditions.js";
import { ConditionFilter } from "./condition-filter";

export interface TilePanelProps {
  draft: Tile;
  /** A tile just added: Save adds it, Cancel takes it away. */
  isNew: boolean;
  /** What is already on the boards, offered under a condition's value; until it loads, values are typed. */
  scope?: SuggestionScope;
  onChange: (next: Tile) => void;
  onSave: () => void;
  onCancel: () => void;
}

const TYPES: readonly { type: TileType; label: string; icon: IconName }[] = [
  { type: "columns", label: "Columns", icon: "ChartColumnStacked" },
  { type: "bars", label: "Bars", icon: "ChartBarStacked" },
  { type: "line", label: "Line", icon: "ChartLine" },
  { type: "ring", label: "Ring", icon: "ChartRing" },
  { type: "list", label: "Task list", icon: "ListBullet" },
  { type: "table", label: "Table", icon: "Table" },
  { type: "big", label: "Big numbers", icon: "NumberSign" },
];

/** The period's choices: the header's, or a unit the exact number of which is typed beside it. */
const PERIOD_LABEL: Record<"page" | WindowUnit, string> = { page: "As in header", minute: "Minutes", hour: "Hours", day: "Days" };

/** The number a unit starts at when picked: an hour of minutes, a day of hours, a month of days. */
const PERIOD_START: Record<WindowUnit, number> = { minute: 60, hour: 24, day: 30 };

const METRIC_LABEL: Record<YMetric, string> = {
  count: "Tasks",
  moves: "Status moves",
  created: "Created",
  closed: "Closed",
  createdClosed: "Created vs closed",
  sum: "Sum of…",
  avg: "Average of…",
  cycle: "Cycle time",
  accuracy: "Actual ÷ planned",
};

const GROUPS = [
  { label: "Properties", kinds: ["listed", "values"] },
  { label: "Dates", kinds: ["date"] },
  { label: "Numbers", kinds: ["number"] },
  { label: "Text", kinds: ["text"] },
] as const;

const fieldLabel = (field: QueryField) => ROW_FIELD_LABELS[field];

/** What each figure counts, in words that leave no doubt — the tile prints the short name. */
const FIGURE_OPTIONS: Record<Figure, { label: string; hint: string }> = {
  open: { label: "Open tasks", hint: "Tasks made or reopened within the chart's period" },
  in_progress: { label: "Taken into progress", hint: "Tasks moved to in progress within the chart's period" },
  in_review: { label: "Sent to review", hint: "Tasks moved to in review within the chart's period" },
  done: { label: "Done", hint: "Tasks moved to done within the chart's period" },
  created: { label: "Created in the period", hint: "Tasks made within the chart's period" },
  closed: { label: "Closed in the period", hint: "Tasks moved to done within the chart's period" },
  cycle: { label: "Median cycle", hint: "Typical time from in progress to done, for tasks closed in the period" },
  planned: { label: "Planned time", hint: "Planned time of the tasks closed within the chart's period" },
  actual: { label: "Actual time", hint: "Actual time of the tasks closed within the chart's period" },
  budget: { label: "Budget", hint: "Budgets of the tasks closed within the chart's period" },
  cost: { label: "Cost", hint: "Costs of the tasks closed within the chart's period" },
  limit: { label: "Limit", hint: "Budget limits of the tasks closed within the chart's period" },
};

/** Every field of the board's filter, grouped by kind. */
function FieldItems() {
  return (
    <>
      {GROUPS.map((group) => (
        <SelectGroup key={group.label}>
          <SelectLabel>{group.label}</SelectLabel>
          {QUERY_FIELDS.filter((field) => (group.kinds as readonly string[]).includes(FIELD_FILTER_KINDS[field])).map((field) => (
            <SelectItem key={field} value={field}>
              {fieldLabel(field)}
            </SelectItem>
          ))}
        </SelectGroup>
      ))}
    </>
  );
}

const NONE = "__none";

function Pick({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="h-7 min-w-0 flex-1 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-2 px-1.5">
      <span className="w-24 shrink-0 text-sm">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="px-1.5 pb-1 text-xs text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Check({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = `tile-check-${label.replace(/\W+/g, "-")}`;
  return (
    <label htmlFor={id} className="flex items-start gap-2 rounded-sm px-1.5 py-1 text-sm hover:bg-state-hover">
      <Checkbox id={id} aria-label={label} className="mt-0.5" checked={checked} onCheckedChange={(next) => onChange(next === true)} />
      <span className="flex min-w-0 flex-col">
        {label}
        {hint === undefined ? null : <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

/** A whole number from a field, or null when it is empty or not one above zero. */
const positive = (text: string): number | null => {
  const value = Number(text);
  return text.trim() === "" || !Number.isFinite(value) || value <= 0 ? null : value;
};

/**
 * The number of minutes, hours or days a period counts. The field may stand
 * empty while a new number is typed; only a whole number from 1 to the
 * unit's cap reaches the tile.
 */
function PeriodLength({ window, onChange }: { window: Exclude<TileWindow, "page">; onChange: (window: TileWindow) => void }) {
  const [text, setText] = useState(String(window.count));
  const cap = WINDOW_COUNT_MAX[window.unit];
  useEffect(() => setText(String(window.count)), [window.count, window.unit]);
  return (
    <Input
      type="number"
      aria-label="Period length"
      min={1}
      max={cap}
      className="h-7 w-16 shrink-0 text-sm"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const count = positive(event.target.value);
        if (count !== null) onChange({ unit: window.unit, count: Math.max(1, Math.min(Math.round(count), cap)) });
      }}
    />
  );
}

/** The table's fields as the list shows them: the shown ones in their order, then the hidden ones in the task table's. */
const columnItems = (columns: readonly QueryField[]): QueryField[] => [...columns, ...TILE_TABLE_FIELDS.filter((field) => !columns.includes(field))];

/** The shown columns after the list's row at `from` moved to `to`: the hidden rows move too, but only the shown ones are kept. */
function movedColumns(columns: readonly QueryField[], from: number, to: number): QueryField[] {
  const items = columnItems(columns);
  const rest = items.filter((_, index) => index !== from);
  return [...rest.slice(0, to), items[from]!, ...rest.slice(to)].filter((field) => columns.includes(field));
}

/** The shown columns with a field shown or hidden; the title stays. */
const toggledColumn = (columns: readonly QueryField[], field: QueryField): QueryField[] =>
  field === "title" ? [...columns] : columns.includes(field) ? columns.filter((column) => column !== field) : [...columns, field];

/** «Columns — drag to reorder»: every field the table can show, a check to show it, a grip to move it — Display's list. */
function TableColumns({ columns, onChange }: { columns: readonly QueryField[]; onChange: (columns: QueryField[]) => void }) {
  const rows = columnItems(columns).map((field) => ({ id: field, label: fieldLabel(field), visible: columns.includes(field), locked: field === "title" }));
  return (
    <ReorderList
      label="Table columns"
      rows={rows}
      onToggle={(field) => onChange(toggledColumn(columns, field as QueryField))}
      onMove={(from, to) => onChange(movedColumns(columns, from, to))}
    />
  );
}

/** The rows a segment shows at first, typed; only a whole number inside the bounds reaches the tile. */
function TableRows({ rows, onChange }: { rows: number; onChange: (rows: number) => void }) {
  const [text, setText] = useState(String(rows));
  useEffect(() => setText(String(rows)), [rows]);
  return (
    <Input
      type="number"
      aria-label="Rows per segment"
      min={TILE_TABLE_ROWS.min}
      max={TILE_TABLE_ROWS.max}
      className="h-7 w-20 shrink-0 text-sm tabular-nums"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const value = positive(event.target.value);
        if (value !== null) onChange(Math.max(TILE_TABLE_ROWS.min, Math.min(TILE_TABLE_ROWS.max, Math.round(value))));
      }}
    />
  );
}

/** What the table under the chart shows, under «Show segment contents»: columns, sort, rows, row height; the filter is the chart's. */
function TableSettings({ table, onChange, onShowFilter }: { table: TileTable; onChange: (table: TileTable) => void; onShowFilter: () => void }) {
  const patch = (next: Partial<TileTable>) => onChange({ ...table, ...next });
  return (
    <div data-table-settings className="flex flex-col gap-2 pt-1 pl-6">
      <div className="flex flex-col gap-1">
        <span className="px-1.5 text-xs text-muted-foreground">Columns — drag to reorder</span>
        <TableColumns columns={table.columns} onChange={(columns) => patch({ columns })} />
      </div>
      <Row label="Sort">
        <Pick
          label="Table sort"
          value={table.sort?.column ?? NONE}
          onChange={(value) => patch({ sort: value === NONE ? null : { column: value as QueryField, direction: table.sort?.direction ?? "asc" } })}
        >
          <SelectItem value={NONE}>None</SelectItem>
          {TILE_TABLE_FIELDS.map((field) => (
            <SelectItem key={field} value={field}>
              {fieldLabel(field)}
            </SelectItem>
          ))}
        </Pick>
        {table.sort === null ? null : (
          <div className="w-24 shrink-0">
            <Segments
              className="flex-1"
              label="Table sort direction"
              value={table.sort.direction}
              options={[
                { value: "asc", label: "Asc" },
                { value: "desc", label: "Desc" },
              ]}
              onChange={(direction) => patch({ sort: { ...table.sort!, direction } })}
            />
          </div>
        )}
      </Row>
      <Row label="Rows">
        <TableRows rows={table.rows} onChange={(rows) => patch({ rows })} />
        <span className="text-sm text-muted-foreground">per segment</span>
      </Row>
      <Row label="Row height">
        <Segments
          className="flex-1"
          label="Row height"
          value={table.rowHeight}
          options={[
            { value: "regular", label: "Regular" },
            { value: "compact", label: "Compact" },
          ]}
          onChange={(rowHeight) => patch({ rowHeight })}
        />
      </Row>
      <p className="px-1.5 text-xs text-muted-foreground">
        Filter — shared with the chart,{" "}
        <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={onShowFilter}>
          in Selection
        </button>
      </p>
    </div>
  );
}

export function TilePanel({ draft, isNew, scope, onChange, onSave, onCancel }: TilePanelProps) {
  const ganttish = draft.type === "bars" && draft.bars.length === "range";
  const uses = (setting: TileSetting) => readsSetting(draft.type, draft.bars.length, setting);
  const set = (patch: Partial<Tile>) => onChange({ ...draft, ...patch });
  const filterRef = useRef<HTMLDivElement | null>(null);
  const display = (patch: Partial<Tile["display"]>) => set({ display: { ...draft.display, ...patch } });
  const showContents = (on: boolean) => {
    const { contents: _contents, ...rest } = draft.display;
    set({ display: on ? { ...rest, contents: CONTENTS_SHARE.start } : rest });
  };
  const fieldMetric = (FIELD_METRICS as readonly YMetric[]).includes(draft.y.metric);
  const chartsTime = draft.type !== "list" && draft.type !== "big";

  return (
    <aside aria-label="Chart settings" className="flex h-full min-h-0 w-full flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center justify-between pr-2 pl-4 text-sm font-medium">
        {isNew ? "New chart" : "Edit chart"}
        <Button type="button" variant="ghost" size="icon" aria-label="Close chart settings" className="size-7 text-muted-foreground" onClick={onCancel}>
          <Icon name="X" className="size-3.5" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2.5 pb-4">
        <Section title="Chart">
          <div role="group" aria-label="Chart type" className="grid grid-cols-4 gap-1 px-1.5">
            {TYPES.map((entry) => (
              <button
                key={entry.type}
                type="button"
                aria-label={entry.label}
                aria-pressed={draft.type === entry.type}
                // Bars print their values beside them from the start; a chart already of bars keeps its own choice.
                onClick={() => set(entry.type === "bars" && draft.type !== "bars" ? { type: entry.type, display: { ...draft.display, yLabels: true } } : { type: entry.type })}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md px-1 pt-2 pb-1.5 text-2xs text-muted-foreground hover:bg-state-hover hover:text-foreground",
                  draft.type === entry.type && "bg-state-active text-foreground",
                )}
              >
                <Icon name={entry.icon} className="size-4" />
                {entry.label}
              </button>
            ))}
          </div>
          <Row label="Title">
            <Input aria-label="Title" maxLength={TILE_TITLE_MAX} className="h-7 text-sm" value={draft.title} onChange={(event) => set({ title: event.target.value })} />
          </Row>
        </Section>

        <Section title="Data">
          {uses("figures") ? (
            <div className="flex flex-col">
              {FIGURES.map((figure) => (
                <Check
                  key={figure}
                  label={FIGURE_OPTIONS[figure].label}
                  hint={FIGURE_OPTIONS[figure].hint}
                  checked={draft.figures.includes(figure)}
                  onChange={(checked) =>
                    set({ figures: FIGURES.filter((entry): entry is Figure => (entry === figure ? checked : draft.figures.includes(entry))) })
                  }
                />
              ))}
            </div>
          ) : null}
          {uses("bars") ? (
            <Row label="Bar length">
              <Segments
                className="flex-1"
                label="Bar length"
                value={draft.bars.length}
                options={[
                  { value: "value", label: "Y value" },
                  { value: "range", label: "Start → Due" },
                ]}
                onChange={(length) => set({ bars: { ...draft.bars, length } })}
              />
            </Row>
          ) : null}
          {ganttish ? (
            <Row label="Shows">
              <Segments
                className="flex-1"
                label="Gantt shows"
                value={draft.bars.gantt}
                options={[
                  { value: "plan", label: "Plan" },
                  { value: "fact", label: "Fact" },
                  { value: "both", label: "Both" },
                ]}
                onChange={(gantt) => set({ bars: { ...draft.bars, gantt } })}
              />
            </Row>
          ) : null}
          {uses("window") ? (
            <Row label="Period">
              <Pick
                label="Period"
                value={draft.window === "page" ? "page" : draft.window.unit}
                onChange={(value) => set({ window: value === "page" ? "page" : { unit: value as WindowUnit, count: PERIOD_START[value as WindowUnit] } })}
              >
                {(["page", ...WINDOW_UNITS] as const).map((choice) => (
                  <SelectItem key={choice} value={choice}>
                    {PERIOD_LABEL[choice]}
                  </SelectItem>
                ))}
              </Pick>
              {draft.window === "page" ? null : <PeriodLength window={draft.window} onChange={(window) => set({ window })} />}
            </Row>
          ) : null}
          {uses("x") && !ganttish ? (
            <Row label="X axis">
              <Pick label="X axis" value={draft.x} onChange={(value) => set({ x: value as Tile["x"] })}>
                <SelectItem value="time">Time</SelectItem>
                <FieldItems />
              </Pick>
            </Row>
          ) : null}
          {uses("y") && !ganttish ? (
            <>
              <Row label="Y axis">
                <Pick
                  label="Y axis"
                  value={draft.y.metric}
                  onChange={(value) => {
                    const metric = value as YMetric;
                    const field = (FIELD_METRICS as readonly YMetric[]).includes(metric) ? (draft.y.field ?? "cost") : null;
                    set({ y: { metric, field } });
                  }}
                >
                  {(Object.keys(METRIC_LABEL) as YMetric[]).map((metric) => (
                    <SelectItem key={metric} value={metric}>
                      {METRIC_LABEL[metric]}
                    </SelectItem>
                  ))}
                </Pick>
              </Row>
              {fieldMetric ? (
                <Row label="">
                  <Pick label="Summed field" value={draft.y.field ?? "cost"} onChange={(value) => set({ y: { ...draft.y, field: value as NumberField } })}>
                    {NUMBER_FIELDS.map((field) => (
                      <SelectItem key={field} value={field}>
                        {fieldLabel(field)}
                      </SelectItem>
                    ))}
                  </Pick>
                </Row>
              ) : null}
            </>
          ) : null}
          {uses("breakdown") && !ganttish ? (
            <Row label={draft.type === "table" ? "Columns" : "Breakdown"}>
              <Pick label="Breakdown" value={draft.breakdown ?? NONE} onChange={(value) => set({ breakdown: value === NONE ? null : (value as QueryField) })}>
                <SelectItem value={NONE}>None</SelectItem>
                <FieldItems />
              </Pick>
            </Row>
          ) : null}
        </Section>

        <Section title="Selection">
          {uses("switch") ? (
            <Row label="Switch">
              <Pick label="Switch" value={draft.switch ?? NONE} onChange={(value) => set({ switch: value === NONE ? null : (value as QueryField) })}>
                <SelectItem value={NONE}>None</SelectItem>
                <FieldItems />
              </Pick>
            </Row>
          ) : null}
          <div ref={filterRef} className="flex flex-col gap-1 px-1.5">
            <span className="text-sm">
              Filter{draft.display.contents === undefined ? null : <span className="text-xs text-muted-foreground"> — chart and table</span>}
            </span>
            <ConditionFilter conditions={draft.conditions} scope={scope} onChange={(conditions) => set({ conditions })} />
          </div>
          {uses("sort") ? (
            <Row label="Sort">
              <Pick
                label="Sort"
                value={draft.sort?.by ?? NONE}
                onChange={(value) => set({ sort: value === NONE ? null : { by: value as NonNullable<Tile["sort"]>["by"], direction: draft.sort?.direction ?? "desc" } })}
              >
                <SelectItem value={NONE}>None</SelectItem>
                <SelectItem value="value">Y value</SelectItem>
                {draft.type === "list" || ganttish ? <SelectItem value="timeInStatus">Time in status</SelectItem> : null}
                <FieldItems />
              </Pick>
              {draft.sort === null ? null : (
                <div className="w-24 shrink-0">
                  <Segments
                    className="flex-1"
                    label="Sort direction"
                    value={draft.sort.direction}
                    options={[
                      { value: "asc", label: "Asc" },
                      { value: "desc", label: "Desc" },
                    ]}
                    onChange={(direction) => set({ sort: { ...draft.sort!, direction } })}
                  />
                </div>
              )}
            </Row>
          ) : null}
          {uses("limit") ? (
            <Row label="Show">
              <Input
                aria-label="Rows shown"
                type="number"
                min={1}
                className="h-7 w-20 text-sm tabular-nums"
                value={draft.limit}
                onChange={(event) => set({ limit: Math.max(1, Math.min(200, Math.round(positive(event.target.value) ?? 1))) })}
              />
              <span className="text-sm text-muted-foreground">{draft.type === "list" || ganttish ? "tasks" : "categories"}</span>
            </Row>
          ) : null}
        </Section>

        {uses("legend") || uses("contents") || (uses("axes") && chartsTime) ? (
          <Section title="Display">
            {uses("legend") ? (
              <Row label="Legend">
                <Segments
                  className="flex-1"
                  label="Legend"
                  value={draft.display.legend}
                  options={[
                    { value: "right", label: "Right" },
                    { value: "bottom", label: "Bottom" },
                    { value: "hidden", label: "Hidden" },
                  ]}
                  onChange={(legend) => display({ legend })}
                />
              </Row>
            ) : null}
            {uses("axes") ? (
              <div className="flex flex-col">
                <Check label="X axis labels" checked={draft.display.xLabels} onChange={(xLabels) => display({ xLabels })} />
                <Check label="Y axis labels" checked={draft.display.yLabels} onChange={(yLabels) => display({ yLabels })} />
              </div>
            ) : null}
            {uses("grid") ? (
              <>
                <Row label="Grid across">
                  <Input
                    aria-label="Grid lines across, every"
                    type="number"
                    min={1}
                    placeholder="Off"
                    className="h-7 w-20 text-sm tabular-nums"
                    value={draft.display.grid.x ?? ""}
                    onChange={(event) => {
                      const every = positive(event.target.value);
                      display({ grid: { ...draft.display.grid, x: every === null ? null : Math.max(1, Math.round(every)) } });
                    }}
                  />
                  <span className="text-sm text-muted-foreground">{draft.type === "bars" ? "rows" : "columns"}</span>
                </Row>
                <Row label="Grid up">
                  <Input
                    aria-label="Grid lines up, every"
                    type="number"
                    min={0}
                    placeholder="Off"
                    className="h-7 w-20 text-sm tabular-nums"
                    value={draft.display.grid.y ?? ""}
                    onChange={(event) => display({ grid: { ...draft.display.grid, y: positive(event.target.value) } })}
                  />
                  <span className="text-sm text-muted-foreground">of the value</span>
                </Row>
              </>
            ) : null}
            {uses("trend") ? <Check label="Trend line" checked={draft.display.trend} onChange={(trend) => display({ trend })} /> : null}
            {uses("contents") ? (
              <Check
                label="Show segment contents"
                hint="Lists the tasks under the chart as a table; a click on a segment narrows it"
                checked={draft.display.contents !== undefined}
                onChange={showContents}
              />
            ) : null}
            {uses("contents") && draft.display.contents !== undefined ? (
              <TableSettings table={tileTable(draft)} onChange={(table) => set({ table })} onShowFilter={() => filterRef.current?.scrollIntoView({ block: "center", behavior: "smooth" })} />
            ) : null}
          </Section>
        ) : null}
      </div>

      <div className="flex shrink-0 gap-2 border-t border-border px-4 py-2.5">
        <Button type="button" variant="outline" size="sm" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" className="flex-1" onClick={onSave}>
          {isNew ? "Add chart" : "Save"}
        </Button>
      </div>
    </aside>
  );
}
