import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
// Type-only: keeps the frontend bundle clear of contract.ts's runtime
// dependencies (zod, the server SDK).
import type { Label, SavedView, SavedViewFilters, Task } from "../../shared/contract.js";
import {
  ACTIVITY_VALUES,
  COUNT_FIELDS,
  LISTED_FILTER_KEYS,
  MAIN_CHECKOUT,
  QUERY_FIELDS,
  SORT_MENU_FIELDS,
  TASK_ESTIMATES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
  type QueryField,
  type TextField,
  type ValueFilterField,
} from "../../shared/enums.js";
import { activeFilterFields, filterTarget, viewSortColumn, worktreeOf, type ColumnSort, type Range } from "../../shared/task-fields.js";
import { listAllTasks, useProjects, useSavedViews, useTasksQuery, useTasksRpc, type TasksRpc } from "../../client/data.js";
import { useTasksNavigation } from "../../client/routes.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  ESTIMATE_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TYPE_ICONS,
  TYPE_LABELS,
} from "../../components/task-meta.js";
import { parentFilterOptions } from "../common/lib.js";
import { slugOf } from "../../shared/format.js";
import { EMPTY_FILTERS, hasActiveFilters, withFieldFilter } from "../common/filter-state.js";
import { storeListPreference, useListPreference } from "../common/list-preference.js";
import { COARSE_POINTER_CHECK_SLOT_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { defaultConfig, normalizeFieldDisplay, ROW_FIELD_LABELS, SORT_FIELD_LABELS, useFieldDisplay } from "../common/row-field-preference.js";
import { applyListState, captureListState, effectiveViewFields, effectiveViewTable, surfaceOf, type ListScopeString, type ViewTarget } from "../common/view-state.js";
import { PriorityIcon, StatusIcon } from "./icons.js";
import {
  applyBoardState,
  captureBoardState,
  DEFAULT_BOARD_LAYOUT,
  loadBoardLayout,
  scopeBoardKey,
  setBoardLayout,
  useBoardLayout,
  type BoardKey,
} from "./board-preference.js";
import { namesInUse, type BoardLayout } from "./grouping.js";
import { fetchBoard } from "./index.js";
import { DEFAULT_TABLE_SETTINGS, setTableSettings, useTableSettings } from "../table/table-preference.js";

/**
 * The controls of a list or a board in the topbar row — the same for both:
 * chips of the active filters and sort, Save view or Reset · Save once the
 * view is changed, then Sort, Filter and Display. A list keeps its filters in
 * list-preference, a board in board-preference; each surface below reads its
 * own store and hands the one toolbar the same controls.
 */

/** A filter is a field's: every field the Display menu offers but the card's widgets. */
type Facet = QueryField;

interface FacetOption {
  value: string;
  name: string;
  glyph?: ReactNode;
}

const FACET_ICONS: Record<Facet, IconName> = {
  parent: "ArrowUp",
  title: "FileText",
  description: "AlignLeft",
  key: "Code",
  priority: "ArrowUpDown",
  status: "Circle",
  slug: "Code",
  active: "Zap",
  assignee: "UserRound",
  flow: "Workflow",
  type: "Target",
  estimate: "ChartColumn",
  labels: "ListTodo",
  subtasks: "Rows3",
  attachments: "Paperclip",
  worktree: "GitBranch",
  takenBy: "Laptop",
  plannedMinutes: "Clock",
  actualMinutes: "Timer",
  budget: "MoneyBag",
  budgetLimit: "DollarCircle",
  cost: "Coins",
  dueDate: "Calendar",
  startDate: "Calendar",
  project: "FolderGit",
  createdAt: "DateTime",
  updatedAt: "Edit",
};

interface FacetEntry {
  id: Facet;
  label: string;
  icon: IconName;
}

/** Every field's filter, in the Display menu's canonical order. */
const FACETS: readonly FacetEntry[] = QUERY_FIELDS.map((id) => ({
  id,
  // A label filter picks one label at a time, as it was spelled before every field had a filter.
  label: id === "labels" ? "Label" : ROW_FIELD_LABELS[id],
  icon: FACET_ICONS[id],
}));

/** The first filters' keys whose values are ticked in a plain menu; Parent searches its values instead. */
type ListedFacet = Exclude<(typeof LISTED_FILTER_KEYS)[keyof typeof LISTED_FILTER_KEYS], "parents">;

/** A filter value as the chip spells it. */
function valueName(facet: ListedFacet, value: string): string {
  switch (facet) {
    case "statuses":
      return STATUS_LABELS[value as Task["status"]] ?? value;
    case "priorities":
      return PRIORITY_LABELS[value as Task["priority"]] ?? value;
    case "types":
      return TYPE_LABELS[value as NonNullable<Task["type"]>] ?? value;
    case "estimates":
      return ESTIMATE_LABELS[value as NonNullable<Task["estimate"]>] ?? value;
    case "labelNames":
    case "assignees":
      return value;
  }
}

/** The tasks and labels a list or board filters over: one project's, or every project's. */
async function fetchScope(rpc: TasksRpc, projectId: string | null): Promise<{ tasks: Task[]; labels: Label[] }> {
  if (projectId !== null) return fetchBoard(rpc, projectId);
  const [tasks, projects] = await Promise.all([listAllTasks(rpc, {}), rpc.call("listProjects", {})]);
  const labels = await Promise.all(
    projects.projects.map((project) =>
      rpc.call("listLabels", { projectId: project.id }).then(
        (result) => result.labels,
        () => [],
      ),
    ),
  );
  return { tasks, labels: labels.flat() };
}

/** The values a filter offers, fetched only while a menu that needs them is open — or a Parent chip that names its tasks is shown. */
function useScopeData(projectId: string | null) {
  return useTasksQuery((rpc) => fetchScope(rpc, projectId), ["tasks:changed", "projects:changed"], [projectId]).data;
}

function useFacetOptions(facet: ListedFacet, projectId: string | null): FacetOption[] {
  const data = useScopeData(projectId);
  switch (facet) {
    case "statuses":
      return TASK_STATUSES.map((value) => ({
        value,
        name: STATUS_LABELS[value],
        glyph: <StatusIcon status={value} className="size-3" />,
      }));
    case "priorities":
      return TASK_PRIORITIES.map((value) => ({
        value,
        name: PRIORITY_LABELS[value],
        glyph: <PriorityIcon priority={value} className="size-3" />,
      }));
    case "types":
      return TASK_TYPES.map((value) => ({
        value,
        name: TYPE_LABELS[value],
        glyph: <Icon name={TYPE_ICONS[value]} className="size-3" />,
      }));
    case "estimates":
      return TASK_ESTIMATES.map((value) => ({ value, name: ESTIMATE_LABELS[value] }));
    case "labelNames":
      return [...new Map((data?.labels ?? []).map((label) => [label.name, label])).values()].map(
        (label) => ({
          value: label.name,
          name: label.name,
          glyph: (
            <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: label.color }} />
          ),
        }),
      );
    case "assignees":
      return namesInUse(data?.tasks ?? [], (task) => task.assignee).map((value) => ({ value, name: value }));
  }
}

const ACTIVITY_NAMES: Record<(typeof ACTIVITY_VALUES)[number], string> = { active: "Active", idle: "Idle" };

/** The values a field added after the first filters offers: the scope's projects, flows, worktrees, machines that took tasks, and whether an agent works. */
function useValueOptions(field: ValueFilterField, projectId: string | null): FacetOption[] {
  const tasks = useScopeData(projectId)?.tasks ?? [];
  const projects = useProjects().data ?? [];
  switch (field) {
    case "project":
      return projects
        .filter((project) => tasks.some((task) => task.projectId === project.id))
        .map((project) => ({ value: project.id, name: project.name }));
    case "flow":
      return namesInUse(tasks, (task) => task.flow?.name).map((value) => ({ value, name: value }));
    case "worktree":
      return [MAIN_CHECKOUT, ...namesInUse(tasks, worktreeOf)].map((value) => ({ value, name: value }));
    case "takenBy":
      return namesInUse(tasks, (task) => task.takenBy?.machine).map((value) => ({ value, name: value }));
    case "active":
      return ACTIVITY_VALUES.map((value) => ({ value, name: ACTIVITY_NAMES[value] }));
  }
}

const keepOpen = (event: Event) => event.preventDefault();

const toggled = (values: readonly string[], value: string) =>
  values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];

/**
 * The checkbox list of one filter's values. A value that is picked but no
 * longer on the board still shows, greyed, so it can be switched off.
 */
function FacetValues({
  facet,
  projectId,
  filters,
  onChange,
}: {
  facet: ListedFacet;
  projectId: string | null;
  filters: SavedViewFilters;
  onChange: (filters: SavedViewFilters) => void;
}) {
  const options = useFacetOptions(facet, projectId);
  const selected: readonly string[] = filters[facet];
  const stale = selected.filter((value) => !options.some((option) => option.value === value));
  const toggle = (value: string) =>
    onChange({ ...filters, [facet]: toggled(selected, value) } as SavedViewFilters);
  return (
    <>
      {options.map((option) => (
        <DropdownMenuCheckboxItem
          key={option.value}
          checked={selected.includes(option.value)}
          onSelect={keepOpen}
          onCheckedChange={() => toggle(option.value)}
        >
          <span className="flex items-center gap-2">
            {option.glyph}
            {option.name}
          </span>
        </DropdownMenuCheckboxItem>
      ))}
      {stale.map((value) => (
        <DropdownMenuCheckboxItem key={`stale:${value}`} checked onSelect={keepOpen} onCheckedChange={() => toggle(value)}>
          <span className="text-muted-foreground">{value}</span>
        </DropdownMenuCheckboxItem>
      ))}
    </>
  );
}

const CHIP_CLASS =
  "flex h-6 shrink-0 items-center rounded-md border border-border bg-secondary text-xs text-foreground";

interface FilterChipProps {
  facet: FacetEntry;
  projectId: string | null;
  filters: SavedViewFilters;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (filters: SavedViewFilters) => void;
  /** The cross: drops the chip and the values it picks. */
  onRemove: () => void;
}

/** What a chip's trigger reads: the facet, and its values when some are picked. */
function ChipLabel({ facet, names }: { facet: FacetEntry; names: readonly string[] }) {
  return (
    <>
      <Icon name={facet.icon} className="size-3" />
      {facet.label}
      {names.length > 0 ? (
        <span className="max-w-48 truncate font-medium">
          {names.length > 2 ? `${names.length} selected` : names.join(", ")}
        </span>
      ) : null}
    </>
  );
}

const CHIP_TRIGGER_CLASS = "flex h-full items-center gap-1.5 pl-2 pr-1";

/** A chip's mark for tests and styles: the first filters keep the key they had before every field had one. */
const chipId = (field: Facet): string => {
  const target = filterTarget(field);
  return target.kind === "listed" ? LISTED_FILTER_KEYS[target.field] : field;
};

/** A chip: its menu, and the cross that drops it with the facet's values. */
function ChipShell({ facet, onRemove, children }: Pick<FilterChipProps, "facet" | "onRemove"> & { children: ReactNode }) {
  return (
    <span className={CHIP_CLASS} data-filter-chip={chipId(facet.id)}>
      {children}
      <button
        type="button"
        aria-label={`Remove ${facet.label} filter`}
        className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-state-hover hover:text-foreground"
        onClick={onRemove}
      >
        <Icon name="X" className="size-3" />
      </button>
    </span>
  );
}

function ListedChip({ facet, facetId, projectId, filters, open, onOpenChange, onChange, onRemove }: FilterChipProps & { facetId: ListedFacet }) {
  const names = filters[facetId].map((value) => valueName(facetId, value));
  return (
    <ChipShell facet={facet} onRemove={onRemove}>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <button type="button" className={CHIP_TRIGGER_CLASS}>
            <ChipLabel facet={facet} names={names} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-44" mobileTitle={facet.label}>
          <FacetValues facet={facetId} projectId={projectId} filters={filters} onChange={onChange} />
        </DropdownMenuContent>
      </DropdownMenu>
    </ChipShell>
  );
}

/**
 * The Parent chip: a field to type in over the tasks it may pick, the typed
 * text narrowing them by key, slug and title; several can be ticked and the
 * menu stays open. A picked task no longer offered still shows, greyed, so it
 * can be switched off.
 */
function ParentChip({ facet, projectId, filters, open, onOpenChange, onChange, onRemove }: FilterChipProps) {
  const tasks = useScopeData(projectId)?.tasks;
  const options = parentFilterOptions(tasks ?? []);
  const byId = new Map((tasks ?? []).map((task) => [task.id, task]));
  const selected = filters.parents;
  const names = selected.map((id) => byId.get(id)?.key ?? slugOf(id));
  const stale = selected.filter((id) => !options.some((option) => option.value === id));
  const toggle = (id: string) => onChange({ ...filters, parents: toggled(selected, id) });
  return (
    <ChipShell facet={facet} onRemove={onRemove}>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button type="button" className={CHIP_TRIGGER_CLASS}>
            <ChipLabel facet={facet} names={names} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0" mobileTitle={facet.label}>
          <Command>
            <CommandInput placeholder="Parent…" />
            <CommandList>
              <CommandEmpty>No task with sub-tasks matches</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={`${option.key} ${option.slug} ${option.title}`}
                    onSelect={() => toggle(option.value)}
                  >
                    {option.type ? <Icon name={TYPE_ICONS[option.type]} className="size-3.5 shrink-0" /> : null}
                    <span className="shrink-0 text-muted-foreground tabular-nums">{option.key}</span>
                    <span className="min-w-0 flex-1 truncate">{option.title}</span>
                    {selected.includes(option.value) ? <Icon name="Check" className="size-3.5 shrink-0" /> : null}
                  </CommandItem>
                ))}
                {stale.map((id) => (
                  <CommandItem key={`stale:${id}`} value={slugOf(id)} onSelect={() => toggle(id)}>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{slugOf(id)}</span>
                    <Icon name="Check" className="size-3.5 shrink-0" />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </ChipShell>
  );
}

/** A chip over values ticked in a plain menu, for the fields filtered since the first seven. */
function ValuesChip({ facet, field, projectId, filters, open, onOpenChange, onChange, onRemove }: FilterChipProps & { field: ValueFilterField }) {
  const options = useValueOptions(field, projectId);
  const selected = filters.values?.[field] ?? [];
  const nameOf = new Map(options.map((option) => [option.value, option.name]));
  const stale = selected.filter((value) => !nameOf.has(value));
  const toggle = (value: string) => onChange(withFieldFilter(filters, { kind: "values", field, values: toggled(selected, value) }));
  return (
    <ChipShell facet={facet} onRemove={onRemove}>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <button type="button" className={CHIP_TRIGGER_CLASS}>
            <ChipLabel facet={facet} names={selected.map((value) => nameOf.get(value) ?? value)} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" collisionPadding={8} className={SCROLLING_MENU_CLASS} mobileTitle={facet.label}>
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={selected.includes(option.value)}
              onSelect={keepOpen}
              onCheckedChange={() => toggle(option.value)}
            >
              <span className="truncate">{option.name}</span>
            </DropdownMenuCheckboxItem>
          ))}
          {stale.map((value) => (
            <DropdownMenuCheckboxItem key={`stale:${value}`} checked onSelect={keepOpen} onCheckedChange={() => toggle(value)}>
              <span className="text-muted-foreground">{value}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </ChipShell>
  );
}

/** A chip over a text field: tasks whose field contains the typed text, case aside. */
function TextChip({ facet, field, filters, open, onOpenChange, onChange, onRemove }: FilterChipProps & { field: TextField }) {
  const text = filters.texts?.[field] ?? "";
  return (
    <ChipShell facet={facet} onRemove={onRemove}>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button type="button" className={CHIP_TRIGGER_CLASS}>
            <ChipLabel facet={facet} names={text.trim() === "" ? [] : [`“${text.trim()}”`]} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" collisionPadding={8} className="w-60 p-2" mobileTitle={facet.label}>
          <Input
            autoFocus
            value={text}
            placeholder="Contains…"
            aria-label={`${facet.label} contains`}
            className="h-7 text-sm"
            onChange={(event) => onChange(withFieldFilter(filters, { kind: "text", field, text: event.target.value }))}
          />
        </PopoverContent>
      </Popover>
    </ChipShell>
  );
}

const NO_RANGE = { from: null, to: null, empty: false } as const;

/** A day as the chip spells it: 01.10, the year only when it is not this one's. */
function dayName(day: string): string {
  const [year, month, date] = day.split("-");
  return year === String(new Date().getFullYear()) ? `${date}.${month}` : `${date}.${month}.${year}`;
}

/** What a range chip reads: "01.10 – 15.10", "≥ 5", "≤ 9", with "or empty" when empty values pass too. */
function rangeName<T extends string | number>(range: Range<T>, spell: (bound: T) => string): string[] {
  const { from, to, empty } = range;
  const bounds =
    from !== null && to !== null
      ? `${spell(from)} – ${spell(to)}`
      : from !== null
        ? `≥ ${spell(from)}`
        : to !== null
          ? `≤ ${spell(to)}`
          : null;
  if (bounds === null) return empty ? ["No value"] : [];
  return [empty ? `${bounds} or empty` : bounds];
}

/**
 * A from–to field of a range chip. The typed text is kept as typed while it
 * does not read as a bound — a half-typed "-" or date — and handed on once it
 * does, or as no bound once cleared.
 */
function BoundInput<T>({
  label,
  type,
  value,
  parse,
  onChange,
}: {
  label: string;
  type: "date" | "number";
  value: T | null;
  parse: (text: string) => T | null;
  onChange: (value: T | null) => void;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  useEffect(() => {
    setDraft((current) => (parse(current) === value ? current : value === null ? "" : String(value)));
  }, [value]);
  return (
    <Input
      type={type}
      value={draft}
      aria-label={label}
      placeholder={label}
      className="h-7 min-w-0 flex-1 text-sm"
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        const bound = parse(text);
        if (bound !== null || text.trim() === "") onChange(bound);
      }}
    />
  );
}

const parseDay = (text: string): string | null => (/^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null);
const parseNumber = (text: string): number | null => {
  const number = text.trim() === "" ? Number.NaN : Number(text);
  return Number.isFinite(number) ? number : null;
};

/** A chip over a date or number field: from and to, either open, and — but for counts — whether empty values pass. */
function RangeChip<T extends string | number>({
  facet,
  open,
  onOpenChange,
  onChange,
  onRemove,
  range,
  type,
  parse,
  spell,
  canBeEmpty,
  set,
}: FilterChipProps & {
  range: Range<T>;
  type: "date" | "number";
  parse: (text: string) => T | null;
  spell: (bound: T) => string;
  canBeEmpty: boolean;
  set: (range: Range<T>) => SavedViewFilters;
}) {
  return (
    <ChipShell facet={facet} onRemove={onRemove}>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button type="button" className={CHIP_TRIGGER_CLASS}>
            <ChipLabel facet={facet} names={rangeName(range, spell)} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" collisionPadding={8} className="w-72 p-2" mobileTitle={facet.label}>
          <div className="flex items-center gap-1.5">
            <BoundInput label="From" type={type} value={range.from} parse={parse} onChange={(from) => onChange(set({ ...range, from }))} />
            <span className="text-muted-foreground">–</span>
            <BoundInput label="To" type={type} value={range.to} parse={parse} onChange={(to) => onChange(set({ ...range, to }))} />
          </div>
          {canBeEmpty ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={range.empty}
              className="mt-1.5 h-7 w-full justify-start gap-2 px-2 text-sm"
              onClick={() => onChange(set({ ...range, empty: !range.empty }))}
            >
              <span className="flex size-3.5 items-center justify-center">
                {range.empty ? <Icon name="Check" className="size-3.5" /> : null}
              </span>
              No value
            </Button>
          ) : null}
        </PopoverContent>
      </Popover>
    </ChipShell>
  );
}

const COUNTS: ReadonlySet<string> = new Set(COUNT_FIELDS);

function FilterChip(props: FilterChipProps) {
  const { filters } = props;
  const target = filterTarget(props.facet.id);
  switch (target.kind) {
    case "listed": {
      const key = LISTED_FILTER_KEYS[target.field];
      return key === "parents" ? <ParentChip {...props} /> : <ListedChip {...props} facetId={key} />;
    }
    case "values":
      return <ValuesChip {...props} field={target.field} />;
    case "text":
      return <TextChip {...props} field={target.field} />;
    case "date":
      return (
        <RangeChip
          {...props}
          range={filters.dates?.[target.field] ?? NO_RANGE}
          type="date"
          parse={parseDay}
          spell={dayName}
          canBeEmpty={target.field === "dueDate" || target.field === "startDate"}
          set={(range) => withFieldFilter(filters, { kind: "date", field: target.field, range })}
        />
      );
    case "number":
      return (
        <RangeChip
          {...props}
          range={filters.numbers?.[target.field] ?? NO_RANGE}
          type="number"
          parse={parseNumber}
          spell={String}
          canBeEmpty={!COUNTS.has(target.field)}
          set={(range) => withFieldFilter(filters, { kind: "number", field: target.field, range })}
        />
      );
  }
}

/** A long menu scrolls within the room the window leaves it. */
const SCROLLING_MENU_CLASS = "min-w-44 max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto";

const ICON_BUTTON_CLASS =
  "relative size-7 shrink-0 text-muted-foreground hover:text-foreground active:bg-state-active active:text-foreground data-[active=true]:text-foreground aria-pressed:bg-state-active aria-pressed:text-foreground max-md:pointer-coarse:size-9";

function CountBadge({ count }: { count: number }) {
  return count > 0 ? (
    <span className="absolute -top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground tabular-nums">
      {count}
    </span>
  ) : null;
}

/** What Filter shows beside a field it filters: how many values are picked, or a tick for a text or a range. */
function FacetMark({ filters, field, active }: { filters: SavedViewFilters; field: Facet; active: boolean }) {
  if (!active) return null;
  const target = filterTarget(field);
  const picked =
    target.kind === "listed"
      ? filters[LISTED_FILTER_KEYS[target.field]].length
      : target.kind === "values"
        ? (filters.values?.[target.field]?.length ?? 0)
        : null;
  return picked === null ? (
    <Icon name="Check" className="ml-auto size-3 text-muted-foreground" />
  ) : (
    <span className="ml-auto text-muted-foreground tabular-nums">{picked}</span>
  );
}

function FilterMenu({
  filters,
  count,
  onPick,
  onClear,
}: {
  filters: SavedViewFilters;
  /** Active filters shown as a badge — when the chips did not fit the row. */
  count: number;
  onPick: (facet: Facet) => void;
  onClear: () => void;
}) {
  const picked = useRef(false);
  const active = activeFilterFields(filters);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Filter"
          data-active={hasActiveFilters(filters)}
          className={ICON_BUTTON_CLASS}
        >
          <Icon name="Filter" className="size-3.5" />
          <CountBadge count={count} />
        </Button>
      </DropdownMenuTrigger>
      {/* A picked facet's chip opens its own menu as this one closes; focus
          sent back to the Filter button would land outside it and shut it.
          Closed without a pick, the menu hands focus back as usual. */}
      <DropdownMenuContent
        align="end"
        collisionPadding={8}
        className={SCROLLING_MENU_CLASS}
        mobileTitle="Filter by"
        onCloseAutoFocus={(event) => {
          if (picked.current) event.preventDefault();
          picked.current = false;
        }}
      >
        <DropdownMenuLabel>Filter by</DropdownMenuLabel>
        {FACETS.map((facet) => (
          <DropdownMenuItem
            key={facet.id}
            onSelect={() => {
              picked.current = true;
              onPick(facet.id);
            }}
          >
            <Icon name={facet.icon} className="size-3" />
            {facet.label}
            <FacetMark filters={filters} field={facet.id} active={active.includes(facet.id)} />
          </DropdownMenuItem>
        ))}
        {hasActiveFilters(filters) ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onClear}>
              <Icon name="X" className="size-3" />
              Clear all filters
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Naming a new view made of the list or board as it stands; the view opens once saved. */
function SaveAsView({ create }: { create: (name: string) => Promise<SavedView> }) {
  const navigation = useTasksNavigation();
  const views = useSavedViews();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const replaces = (views.data ?? []).some(
    (view) => trimmed !== "" && view.name.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  const save = () => {
    if (trimmed === "") return;
    create(trimmed)
      .then((savedView) => {
        views.refresh();
        setOpen(false);
        setName("");
        navigation.go({ kind: "view", savedViewId: savedView.id });
      })
      .catch((thrown: unknown) => setError(thrown instanceof Error ? thrown.message : String(thrown)));
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2.5 text-muted-foreground">
          Save view
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-2" mobileTitle="Save view">
        <Input
          autoFocus
          value={name}
          placeholder="View name"
          aria-label="View name"
          className="h-7 text-sm"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
          }}
        />
        {replaces ? <p className="mt-1 text-xs text-muted-foreground">Replaces the view with this name</p> : null}
        {error !== null ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
      </PopoverContent>
    </Popover>
  );
}

const sameState = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Reset and Save for an open view whose list or board moved off what it saved. */
function ViewChanges({ onReset, onSave }: { onReset: () => void; onSave: () => Promise<unknown> }) {
  const views = useSavedViews();
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    setError(null);
    onSave()
      .then(() => views.refresh())
      .catch((thrown: unknown) => setError(thrown instanceof Error ? thrown.message : String(thrown)));
  };
  return (
    <>
      {error !== null ? (
        // Kept to one short line: the row also carries the Sort, Filter and Display icons.
        <span className="max-w-40 shrink truncate text-xs text-destructive" title={error}>
          {error}
        </span>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 px-2.5 text-muted-foreground"
        onClick={() => {
          setError(null);
          onReset();
        }}
      >
        Reset
      </Button>
      <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 px-2.5" onClick={save}>
        Save
      </Button>
    </>
  );
}

/**
 * Whether the chips outgrow their slot. The slot takes the row's free width
 * whatever it holds, so measuring the chips against it cannot flip-flop: a
 * collapsed row keeps the chips laid out, invisible, to measure them.
 */
function useChipsOverflow(deps: readonly unknown[]) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const chipsRef = useRef<HTMLDivElement | null>(null);
  const [overflows, setOverflows] = useState(false);
  const measure = () => {
    const slot = slotRef.current;
    const chips = chipsRef.current;
    if (!slot || !chips) return;
    setOverflows(chips.scrollWidth > slot.clientWidth + 1);
  };
  useLayoutEffect(measure, deps);
  useEffect(() => {
    const slot = slotRef.current;
    if (!slot || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    return () => observer.disconnect();
  }, []);
  return { slotRef, chipsRef, overflows };
}

/** What either surface hands the toolbar: its filters, how to change them, its sort control, and its save controls. */
interface ViewControls {
  /** The project whose tasks the filters offer; null — every project's. */
  projectId: string | null;
  filters: SavedViewFilters;
  setFilters: (filters: SavedViewFilters) => void;
  /** The chip for the surface's current sort, shown among the filter chips; null while unsorted. */
  sortChip: ReactNode;
  /** The Sort button and its own menu — a board's list-style choices, a table's column list. */
  sortMenu: ReactNode;
  /** Save view, Reset · Save, or nothing when the view is as saved. */
  changes: ReactNode;
}

export interface ViewToolbarProps {
  target: ViewTarget;
  /** Compact viewport: the chips give their room to the title and fold into the Filter badge. */
  compact: boolean;
  displayOpen: boolean;
  onToggleDisplay: () => void;
}

/** A row's own props: a page without a Display panel passes no toggle and gets no Display button. */
type RowProps = Pick<ViewToolbarProps, "compact"> & Partial<Pick<ViewToolbarProps, "displayOpen" | "onToggleDisplay">>;

function ToolbarRow({ controls, compact, displayOpen, onToggleDisplay }: RowProps & { controls: ViewControls }) {
  const { projectId, filters, setFilters, sortChip, sortMenu, changes } = controls;
  // The chip whose value menu is open.
  const [openFacet, setOpenFacet] = useState<Facet | null>(null);
  // Chips shown whether or not they filter: a facet picked from Filter, or a
  // chip once opened, stays — empty too — until its cross or another view.
  // Never saved: an empty chip filters nothing.
  const [kept, setKept] = useState<readonly Facet[]>([]);
  const keep = (facet: Facet) => setKept((facets) => (facets.includes(facet) ? facets : [...facets, facet]));
  const open = (facet: Facet) => {
    keep(facet);
    setOpenFacet(facet);
  };
  const active = activeFilterFields(filters);
  const shownFacets = FACETS.filter((facet) => active.includes(facet.id) || kept.includes(facet.id));
  const { slotRef, chipsRef, overflows } = useChipsOverflow([filters, sortChip, kept]);
  const collapsed = compact || overflows;
  const chip = (facet: FacetEntry) => (
    <FilterChip
      key={facet.id}
      facet={facet}
      projectId={projectId}
      filters={filters}
      open={openFacet === facet.id}
      onOpenChange={(isOpen) => (isOpen ? open(facet.id) : setOpenFacet(null))}
      onChange={setFilters}
      onRemove={() => {
        setKept((facets) => facets.filter((shown) => shown !== facet.id));
        setFilters(withFieldFilter(filters, { kind: "clear", field: facet.id }));
      }}
    />
  );
  // Folded chips still open one: the facet just picked from Filter shows on
  // its own so its value menu has somewhere to hang.
  const pickedWhileFolded = collapsed ? FACETS.find((facet) => facet.id === openFacet) : undefined;
  const activeCount = active.length;

  return (
    <>
      <div ref={slotRef} className="relative flex h-full min-w-0 flex-1 items-center">
        {pickedWhileFolded ? chip(pickedWhileFolded) : null}
        <div
          ref={chipsRef}
          aria-hidden={collapsed || undefined}
          className={cn(
            "flex items-center gap-1.5",
            collapsed ? "pointer-events-none invisible absolute left-0" : "min-w-0 overflow-hidden",
          )}
        >
          {collapsed ? null : shownFacets.map(chip)}
          {sortChip}
        </div>
      </div>
      {changes}
      {sortMenu}
      <FilterMenu
        filters={filters}
        count={collapsed ? activeCount : 0}
        onPick={open}
        onClear={() => {
          setKept([]);
          setFilters(EMPTY_FILTERS);
        }}
      />
      {onToggleDisplay === undefined ? null : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Display"
          aria-pressed={displayOpen}
          className={ICON_BUTTON_CLASS}
          onClick={onToggleDisplay}
        >
          <Icon name="SlidersHorizontal" className="size-3.5" />
        </Button>
      )}
    </>
  );
}

/**
 * The filters of a page that is no list — Analytics: the same chips and the
 * same Filter menu over every project's tasks, without Sort, Display or a
 * view to save.
 */
export function PageFilters({ filters, onChange, compact }: { filters: SavedViewFilters; onChange: (filters: SavedViewFilters) => void; compact: boolean }) {
  return <ToolbarRow compact={compact} controls={{ projectId: null, filters, setFilters: onChange, sortChip: null, sortMenu: null, changes: null }} />;
}

/** Which way a sort runs: up ascending, down descending. */
function DirectionIcon({ direction, className }: { direction: ColumnSort["direction"]; className: string }) {
  return (
    <Icon
      name={direction === "asc" ? "ArrowUp" : "ArrowDown"}
      aria-label={direction === "asc" ? "Ascending" : "Descending"}
      className={className}
    />
  );
}

/** The chip a surface's current sort draws among the filter chips — its field and direction — with a way back to unsorted; null while unsorted. */
function sortChipOf(sort: ColumnSort | null, onClear: () => void): ReactNode {
  if (sort === null) return null;
  return (
    <span className={CHIP_CLASS}>
      <span className="flex items-center gap-1.5 pl-2 pr-1">
        <Icon name="Sort" className="size-3" />
        <span className="font-medium">{SORT_FIELD_LABELS[sort.column]}</span>
        <DirectionIcon direction={sort.direction} className="size-3 text-muted-foreground" />
      </span>
      <button
        type="button"
        aria-label="Clear sort"
        className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-state-hover hover:text-foreground"
        onClick={onClear}
      >
        <Icon name="X" className="size-3" />
      </button>
    </span>
  );
}

/**
 * The Sort button of a table and of a board alike: every field as a checkbox
 * item, labeled by field, the sorted one marked by an arrow the way it runs.
 * Picking an unsorted field sorts ascending; picking the field already sorted
 * by reverses it.
 */
function SortMenu({ sort, onChange }: { sort: ColumnSort | null; onChange: (sort: ColumnSort | null) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="Sort" data-active={sort !== null} className={ICON_BUTTON_CLASS}>
          <Icon name="Sort" className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={8} className={SCROLLING_MENU_CLASS} mobileTitle="Sort by">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        {SORT_MENU_FIELDS.map((column) => {
          const checked = sort?.column === column;
          return (
            <DropdownMenuCheckboxItem
              key={column}
              checked={checked}
              indicator={checked && sort !== null ? <DirectionIcon direction={sort.direction} className={COARSE_POINTER_CHECK_SLOT_CLASS} /> : undefined}
              onCheckedChange={() =>
                onChange({ column, direction: checked && sort?.direction === "asc" ? "desc" : "asc" })
              }
            >
              {SORT_FIELD_LABELS[column]}
            </DropdownMenuCheckboxItem>
          );
        })}
        {sort !== null ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange(null)}>Clear sort</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A board's controls: its layout's filters and sort, saved as a board view — any screen, not just a project's own. */
function BoardToolbar({ scope, view, ...row }: Omit<ViewToolbarProps, "target"> & { scope: ListScopeString; view: SavedView | null }) {
  const rpc = useTasksRpc();
  const key: BoardKey = scopeBoardKey(scope, view?.id ?? null);
  const layout = useBoardLayout(key);
  const fields = useFieldDisplay(key);
  const update = (patch: Partial<BoardLayout>) => setBoardLayout(key, { ...loadBoardLayout(key), ...patch });
  const { projectId, listScope } = surfaceOf(scope);
  const createView = (name: string) =>
    rpc
      .call("createSavedView", { name, projectId, listScope, surface: "board", ...captureBoardState(key) })
      .then(({ savedView }) => {
        // The new view starts from exactly what was saved.
        applyBoardState(scopeBoardKey(scope, savedView.id), savedView);
        return savedView;
      });
  const changed =
    view === null
      ? !sameState({ ...DEFAULT_BOARD_LAYOUT, fields: defaultConfig("board") }, { ...layout, fields })
      : !sameState(
          { filters: view.filters, sort: view.sort, board: view.board, fields: normalizeFieldDisplay(key, view.fields) },
          { filters: layout.filters, sort: layout.sort, board: layout.grouping, fields },
        );
  const changes = !changed ? null : view === null ? (
    <SaveAsView create={createView} />
  ) : (
    <ViewChanges
      onReset={() => applyBoardState(key, view)}
      onSave={() => rpc.call("createSavedView", { name: view.name, projectId, listScope, surface: "board", ...captureBoardState(key) })}
    />
  );
  return (
    <ToolbarRow
      {...row}
      controls={{
        projectId,
        filters: layout.filters,
        setFilters: (filters) => update({ filters }),
        sortChip: sortChipOf(viewSortColumn(layout.sort), () => update({ sort: "manual" })),
        sortMenu: <SortMenu sort={viewSortColumn(layout.sort)} onChange={(sort) => update({ sort: sort ?? "manual" })} />,
        changes,
      }}
    />
  );
}

/** A table's controls: its scope's filters and column sort, saved as a table view. */
function TableToolbar({ scope, view, ...row }: Omit<ViewToolbarProps, "target"> & { scope: ListScopeString; view: SavedView | null }) {
  const rpc = useTasksRpc();
  const preference = useListPreference(scope);
  const fields = useFieldDisplay(scope);
  const table = useTableSettings(scope);
  const createView = (name: string) =>
    rpc.call("createSavedView", { name, surface: "table", ...captureListState(scope) }).then(({ savedView }) => savedView);
  const saved =
    view === null
      ? { filters: EMPTY_FILTERS, fields: defaultConfig("list"), table: DEFAULT_TABLE_SETTINGS }
      : { filters: view.filters, fields: normalizeFieldDisplay(scope, effectiveViewFields(view.fields)), table: effectiveViewTable(view) };
  const changed = !sameState(saved, { filters: preference.filters, fields, table });
  const changes = !changed ? null : view === null ? (
    <SaveAsView create={createView} />
  ) : (
    <ViewChanges
      onReset={() => applyListState(view)}
      onSave={() => rpc.call("createSavedView", { name: view.name, surface: "table", ...captureListState(scope) })}
    />
  );
  return (
    <ToolbarRow
      {...row}
      controls={{
        projectId: surfaceOf(scope).projectId,
        filters: preference.filters,
        setFilters: (filters) => storeListPreference(scope, { ...preference, filters }),
        sortChip: sortChipOf(table.sort, () => setTableSettings(scope, { sort: null })),
        sortMenu: <SortMenu sort={table.sort} onChange={(sort) => setTableSettings(scope, { sort })} />,
        changes,
      }}
    />
  );
}

export function ViewToolbar({ target, ...row }: ViewToolbarProps) {
  return target.layout === "board" ? (
    <BoardToolbar key={`board:${target.scope}:${target.view?.id ?? ""}`} scope={target.scope} view={target.view} {...row} />
  ) : (
    <TableToolbar key={`table:${target.scope}:${target.view?.id ?? ""}`} scope={target.scope} view={target.view} {...row} />
  );
}
