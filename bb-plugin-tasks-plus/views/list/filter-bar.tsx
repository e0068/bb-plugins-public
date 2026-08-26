import type { ReactNode } from "react";
import {
  TASK_ESTIMATES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
  type TaskEstimate,
  type TaskPriority,
  type TaskStatus,
  type TaskType,
} from "../../shared/enums.js";
import { LIST_SORTS, type ListSort } from "../../shared/sort.js";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { PriorityIcon, StatusIcon } from "./icons.js";
import {
  ESTIMATE_LABELS,
  TYPE_ICONS,
  TYPE_LABELS,
} from "../detail/meta.js";
import {
  PRIORITY_LABELS,
  SORT_LABELS,
  STATUS_LABELS,
  type LabelFilterOption,
} from "./lib.js";

function toggled<T>(values: readonly T[], value: T, checked: boolean): T[] {
  if (checked) return values.includes(value) ? [...values] : [...values, value];
  return values.filter((existing) => existing !== value);
}

function FilterChip({
  icon,
  label,
  selectedNames,
  children,
}: {
  icon: IconName;
  label: string;
  selectedNames: readonly string[];
  children: ReactNode;
}) {
  const active = selectedNames.length > 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs max-md:pointer-coarse:h-8",
            active
              ? "border-border bg-secondary text-foreground"
              : "border-dashed border-border text-muted-foreground hover:border-input hover:text-foreground",
          )}
        >
          <Icon name={icon} className="size-3" />
          {label}
          {active ? (
            <span className="max-w-48 truncate font-medium @max-md:max-w-24">
              {selectedNames.join(", ")}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SortChip({
  sort,
  onChange,
}: {
  sort: ListSort;
  onChange: (sort: ListSort) => void;
}) {
  const active = sort !== "manual";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-6 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs max-md:pointer-coarse:h-8",
            active
              ? "border-border bg-secondary text-foreground"
              : "border-dashed border-border text-muted-foreground hover:border-input hover:text-foreground",
          )}
        >
          <Icon name="Sort" className="size-3" />
          Sort
          {active ? (
            <span className="font-medium">{SORT_LABELS[sort]}</span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      {/* Checkbox items with exactly-one-checked semantics: the shared radio
          primitives render nothing on compact viewports. */}
      <DropdownMenuContent
        align="end"
        className="min-w-44"
        mobileTitle="Sort tasks"
      >
        {LIST_SORTS.map((option) => (
          <DropdownMenuCheckboxItem
            key={option}
            checked={sort === option}
            onCheckedChange={(checked) => {
              if (checked === true) onChange(option);
            }}
          >
            {SORT_LABELS[option]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface ListFilterState {
  statuses: TaskStatus[];
  priorities: TaskPriority[];
  types: TaskType[];
  estimates: TaskEstimate[];
  labelNames: string[];
}

export const EMPTY_FILTERS: ListFilterState = {
  statuses: [],
  priorities: [],
  types: [],
  estimates: [],
  labelNames: [],
};

export function hasActiveFilters(filters: ListFilterState): boolean {
  return (
    filters.statuses.length > 0 ||
    filters.priorities.length > 0 ||
    filters.types.length > 0 ||
    filters.estimates.length > 0 ||
    filters.labelNames.length > 0
  );
}

export function ListFilterBar({
  filters,
  onChange,
  sort,
  onSortChange,
  labelOptions,
  taskCount,
}: {
  filters: ListFilterState;
  onChange: (filters: ListFilterState) => void;
  sort: ListSort;
  onSortChange: (sort: ListSort) => void;
  labelOptions: readonly LabelFilterOption[];
  taskCount: number | undefined;
}) {
  const keepOpen = (event: Event) => event.preventDefault();
  // Show the Label chip whenever there are options or a remembered selection
  // (including stale names that no longer exist in the catalog).
  const showLabelChip =
    labelOptions.length > 0 || filters.labelNames.length > 0;
  return (
    // The chips live in their own horizontal scroller while the task count is
    // pinned outside it, so the count never wraps and stays visible however
    // many chips overflow a narrow container.
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border-hairline px-3.5 py-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
        <FilterChip
          icon="Circle"
          label="Status"
          selectedNames={filters.statuses.map(
            (status) => STATUS_LABELS[status],
          )}
        >
          {TASK_STATUSES.map((status) => (
            <DropdownMenuCheckboxItem
              key={status}
              checked={filters.statuses.includes(status)}
              onSelect={keepOpen}
              onCheckedChange={(checked) =>
                onChange({
                  ...filters,
                  statuses: toggled(filters.statuses, status, checked === true),
                })
              }
            >
              <span className="flex items-center gap-2">
                <StatusIcon status={status} className="size-3" />
                {STATUS_LABELS[status]}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </FilterChip>
        <FilterChip
          icon="ArrowUpDown"
          label="Priority"
          selectedNames={filters.priorities.map(
            (priority) => PRIORITY_LABELS[priority],
          )}
        >
          {TASK_PRIORITIES.map((priority) => (
            <DropdownMenuCheckboxItem
              key={priority}
              checked={filters.priorities.includes(priority)}
              onSelect={keepOpen}
              onCheckedChange={(checked) =>
                onChange({
                  ...filters,
                  priorities: toggled(
                    filters.priorities,
                    priority,
                    checked === true,
                  ),
                })
              }
            >
              <span className="flex items-center gap-2">
                <PriorityIcon priority={priority} className="size-3" />
                {PRIORITY_LABELS[priority]}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </FilterChip>
        <FilterChip
          icon="Target"
          label="Type"
          selectedNames={filters.types.map((type) => TYPE_LABELS[type])}
        >
          {TASK_TYPES.map((type) => (
            <DropdownMenuCheckboxItem
              key={type}
              checked={filters.types.includes(type)}
              onSelect={keepOpen}
              onCheckedChange={(checked) =>
                onChange({
                  ...filters,
                  types: toggled(filters.types, type, checked === true),
                })
              }
            >
              <span className="flex items-center gap-2">
                <Icon name={TYPE_ICONS[type]} className="size-3" />
                {TYPE_LABELS[type]}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </FilterChip>
        <FilterChip
          icon="ChartColumn"
          label="Estimate"
          selectedNames={filters.estimates.map(
            (estimate) => ESTIMATE_LABELS[estimate],
          )}
        >
          {TASK_ESTIMATES.map((estimate) => (
            <DropdownMenuCheckboxItem
              key={estimate}
              checked={filters.estimates.includes(estimate)}
              onSelect={keepOpen}
              onCheckedChange={(checked) =>
                onChange({
                  ...filters,
                  estimates: toggled(
                    filters.estimates,
                    estimate,
                    checked === true,
                  ),
                })
              }
            >
              <span className="flex items-center gap-2">
                {ESTIMATE_LABELS[estimate]}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </FilterChip>
        {showLabelChip ? (
          <FilterChip
            icon="ListTodo"
            label="Label"
            selectedNames={filters.labelNames}
          >
            {labelOptions.map((option) => (
              <DropdownMenuCheckboxItem
                key={option.name}
                checked={filters.labelNames.includes(option.name)}
                onSelect={keepOpen}
                onCheckedChange={(checked) =>
                  onChange({
                    ...filters,
                    labelNames: toggled(
                      filters.labelNames,
                      option.name,
                      checked === true,
                    ),
                  })
                }
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{ backgroundColor: option.color }}
                  />
                  {option.name}
                </span>
              </DropdownMenuCheckboxItem>
            ))}
            {filters.labelNames
              .filter(
                (name) => !labelOptions.some((option) => option.name === name),
              )
              .map((name) => (
                <DropdownMenuCheckboxItem
                  key={`stale:${name}`}
                  checked
                  onSelect={keepOpen}
                  onCheckedChange={(checked) =>
                    onChange({
                      ...filters,
                      labelNames: toggled(
                        filters.labelNames,
                        name,
                        checked === true,
                      ),
                    })
                  }
                >
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span
                      aria-hidden
                      className="size-2 rounded-full bg-muted-foreground/40"
                    />
                    {name}
                    <span className="text-xs">(unavailable)</span>
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
          </FilterChip>
        ) : null}
        {hasActiveFilters(filters) ? (
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTERS)}
            className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-dashed border-border px-2.5 text-xs text-muted-foreground hover:border-input hover:text-foreground max-md:pointer-coarse:h-8"
          >
            <Icon name="X" className="size-3" />
            Clear
          </button>
        ) : null}
      </div>
      {/* Sort and the count sit outside the scroller so they stay visible and
          aligned however far the filter chips overflow. */}
      <SortChip sort={sort} onChange={onSortChange} />
      <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-subtle-foreground">
        {taskCount === undefined
          ? ""
          : `${taskCount} ${taskCount === 1 ? "task" : "tasks"}`}
      </span>
    </div>
  );
}
