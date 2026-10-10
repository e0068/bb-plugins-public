// Type-only: keeps the frontend bundle clear of contract.ts's runtime dependencies.
import type { SavedViewFilters } from "../../shared/contract.js";
import {
  LISTED_FILTER_KEYS,
  type DateField,
  type NumberField,
  type QueryField,
  type TextField,
  type ValueFilterField,
} from "../../shared/enums.js";
import { activeFilterFields, filterTarget, rangeActive, type Range } from "../../shared/task-fields.js";

/**
 * The filter bar's state: the first seven filters by their own keys, every
 * other field in `values`, `texts`, `dates` and `numbers` — present only
 * while it filters something, so a state that filters nothing is exactly
 * {@link EMPTY_FILTERS}.
 */
export type ListFilterState = SavedViewFilters;

export const EMPTY_FILTERS: ListFilterState = {
  statuses: [],
  priorities: [],
  types: [],
  estimates: [],
  labelNames: [],
  assignees: [],
  parents: [],
};

export const hasActiveFilters = (filters: ListFilterState): boolean => activeFilterFields(filters).length > 0;

/** One field's filter as the menu sets it — or cleared. */
export type FieldFilter =
  | { kind: "values"; field: ValueFilterField; values: readonly string[] }
  | { kind: "text"; field: TextField; text: string }
  | { kind: "date"; field: DateField; range: Range<string> }
  | { kind: "number"; field: NumberField; range: Range<number> }
  | { kind: "clear"; field: QueryField };

type Group = "values" | "texts" | "dates" | "numbers";

/** A group with one entry set, or removed when it filters nothing; a group left empty goes too. */
function withEntry<G extends Group>(
  filters: ListFilterState,
  group: G,
  field: string,
  entry: unknown,
): ListFilterState {
  const { [field]: _dropped, ...rest } = (filters[group] ?? {}) as Record<string, unknown>;
  const next = entry === undefined ? rest : { ...rest, [field]: entry };
  const { [group]: _old, ...others } = filters;
  return (Object.keys(next).length === 0 ? others : { ...others, [group]: next }) as ListFilterState;
}

/** The filter state with one field's filter set, or cleared. */
export function withFieldFilter(filters: ListFilterState, change: FieldFilter): ListFilterState {
  switch (change.kind) {
    case "values":
      return withEntry(filters, "values", change.field, change.values.length > 0 ? [...change.values] : undefined);
    case "text":
      return withEntry(filters, "texts", change.field, change.text.trim() !== "" ? change.text : undefined);
    case "date":
      return withEntry(filters, "dates", change.field, rangeActive(change.range) ? { ...change.range } : undefined);
    case "number":
      return withEntry(filters, "numbers", change.field, rangeActive(change.range) ? { ...change.range } : undefined);
    case "clear": {
      const target = filterTarget(change.field);
      if (target.kind === "listed") return { ...filters, [LISTED_FILTER_KEYS[target.field]]: [] };
      return (["values", "texts", "dates", "numbers"] as const).reduce(
        (state, group) => withEntry(state, group, change.field, undefined),
        filters,
      );
    }
  }
}
