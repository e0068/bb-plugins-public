import { useCallback, useMemo, useSyncExternalStore } from "react";
// Type-only, as columns.ts: the frontend bundle stays clear of contract.ts's runtime.
import type { Task } from "../../shared/contract.js";
import { DATE_FORMATS, TABLE_COLUMN_WIDTH, type DateFormat } from "../../shared/enums.js";
import { firstParagraph } from "../../shared/first-paragraph.js";
import { recordValue, type FieldType, type SectionField } from "../../shared/section-fields.js";
import { moveColumn } from "./columns.js";

/**
 * The look of a section's table: the record's title, the two dates the
 * database keeps and a column per field, each with the menu a task column has
 * — sort, pin, hide, width, a date's format — and moved by dragging. Kept per
 * section in the browser profile, like the task table's look
 * (docs/specs/BBPL-901-tasks-zapis-tablicy-otkryvaetsya-kasimovym.md).
 */

export type SectionColumn = "title" | "description" | "createdAt" | "updatedAt" | `field:${string}`;

export const fieldColumn = (name: string): SectionColumn => `field:${name}`;

/** The field a column draws, or null for the title, the text and the dates. */
export const fieldNameOf = (column: SectionColumn): string | null => (column.startsWith("field:") ? column.slice("field:".length) : null);

export interface SectionSort {
  readonly column: SectionColumn;
  readonly direction: "asc" | "desc";
}

export interface SectionLayout {
  /** Columns in the order a drag left them; columns it never moved follow in their own order. */
  readonly order: readonly SectionColumn[];
  readonly hidden: readonly SectionColumn[];
  readonly pinned: readonly SectionColumn[];
  readonly widths: Readonly<Record<string, number>>;
  readonly sort: SectionSort | null;
  readonly formats: Readonly<Record<string, DateFormat>>;
}

/** The record's text — its first paragraph — is a column too, hidden until the Display panel shows it. */
export const DEFAULT_SECTION_LAYOUT: SectionLayout = { order: [], hidden: ["description"], pinned: ["title"], widths: {}, sort: null, formats: {} };

const OWN_COLUMNS: readonly SectionColumn[] = ["title", "description", "createdAt", "updatedAt"];

export const DEFAULT_SECTION_FORMAT: DateFormat = "dateTime";

export const sectionColumnWidth = (layout: SectionLayout, column: SectionColumn): number => layout.widths[column] ?? (column === "title" ? 360 : column === "description" ? 280 : 140);

/** Every column of the section in the layout's order: the moved ones first as they were left, then the rest. */
export function allSectionColumns(fields: readonly SectionField[], layout: SectionLayout): SectionColumn[] {
  const natural = [...OWN_COLUMNS, ...fields.map((field) => fieldColumn(field.name))];
  const known = new Set(natural);
  const placed = [...new Set(layout.order)].filter((column) => known.has(column));
  const placedSet = new Set(placed);
  return [...placed, ...natural.filter((column) => !placedSet.has(column))];
}

/** The columns drawn: all but the hidden — the title is always drawn — pinned ones leading in their order. */
export function visibleSectionColumns(fields: readonly SectionField[], layout: SectionLayout): SectionColumn[] {
  const hidden = new Set<SectionColumn>(layout.hidden.filter((column) => column !== "title"));
  const shown = allSectionColumns(fields, layout).filter((column) => !hidden.has(column));
  const pinned = new Set(layout.pinned);
  return [...shown.filter((column) => pinned.has(column)), ...shown.filter((column) => !pinned.has(column))];
}

/** The layout after `column` is dragged to `toIndex` among the drawn columns; dropping among the pinned pins it. */
export function movedSectionLayout(fields: readonly SectionField[], layout: SectionLayout, column: SectionColumn, toIndex: number): SectionLayout {
  const visible = visibleSectionColumns(fields, layout);
  const moved = moveColumn(visible, layout.pinned, column, toIndex);
  const drawn = new Set(moved.columns);
  return { ...layout, order: [...moved.columns, ...allSectionColumns(fields, layout).filter((entry) => !drawn.has(entry))], pinned: moved.pinned };
}

export const withToggled = (list: readonly SectionColumn[], column: SectionColumn): SectionColumn[] =>
  list.includes(column) ? list.filter((entry) => entry !== column) : [...list, column];

export const withWidth = (layout: SectionLayout, column: SectionColumn, width: number | null): SectionLayout => {
  const { [column]: _old, ...rest } = layout.widths;
  return {
    ...layout,
    widths: width === null ? rest : { ...rest, [column]: Math.round(Math.min(TABLE_COLUMN_WIDTH.max, Math.max(TABLE_COLUMN_WIDTH.min, width))) },
  };
};

// ---------------------------------------------------------------------------
// Sorting by a column, the way the column's type reads
// ---------------------------------------------------------------------------

/** A record's value in a column, as text; "" for none. */
export function sectionValue(task: Pick<Task, "title" | "description" | "createdAt" | "updatedAt" | "properties" | "labelIds">, column: SectionColumn): string {
  if (column === "title") return task.title;
  if (column === "description") return firstParagraph(task.description);
  if (column === "createdAt") return task.createdAt;
  if (column === "updatedAt") return task.updatedAt;
  return recordValue(task, fieldNameOf(column) ?? "");
}

/** A number field's value, or null for text that is no number. */
export const numberOf = (value: string): number | null => {
  const parsed = value.trim() === "" ? Number.NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const isChecked = (value: string): boolean => value.trim().toLowerCase() === "true";

/** Two values of a type, ascending; null when either is empty, so the caller can put the empty last both ways. */
function compareValues(type: FieldType, a: string, b: string): number | null {
  if (type === "checkbox") return Number(isChecked(b)) - Number(isChecked(a));
  if (type === "number") {
    const [x, y] = [numberOf(a), numberOf(b)];
    return x === null || y === null ? null : x - y;
  }
  return a === "" || b === "" ? null : a.localeCompare(b);
}

/** The records ordered by the sort, the empty values last both ways; unsorted when there is no sort. */
export function sortedRecords<T extends Pick<Task, "title" | "description" | "createdAt" | "updatedAt" | "properties" | "labelIds">>(
  records: readonly T[],
  sort: SectionSort | null,
  fields: readonly SectionField[],
): T[] {
  if (sort === null) return [...records];
  const name = fieldNameOf(sort.column);
  const type: FieldType = name === null ? (sort.column === "title" || sort.column === "description" ? "text" : "date") : (fields.find((field) => field.name === name)?.type ?? "text");
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...records].sort((x, y) => {
    const [a, b] = [sectionValue(x, sort.column), sectionValue(y, sort.column)];
    const compared = compareValues(type, a, b);
    if (compared !== null) return sign * compared;
    // Empty — or no number — last, whichever way the column sorts.
    const blank = (value: string) => value === "" || (type === "number" && numberOf(value) === null);
    return Number(blank(a)) - Number(blank(b));
  });
}

// ---------------------------------------------------------------------------
// Shell: the layouts in the browser profile, by section
// ---------------------------------------------------------------------------

export const SECTION_LAYOUT_STORAGE_KEY = "bb-tasks:section-tables";

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const isColumn = (value: unknown): value is SectionColumn =>
  typeof value === "string" && ((OWN_COLUMNS as readonly string[]).includes(value) || value.startsWith("field:"));
const columnsOf = (raw: unknown, fallback: readonly SectionColumn[]): SectionColumn[] => (Array.isArray(raw) ? [...new Set(raw.filter(isColumn))] : [...fallback]);
const FORMAT_SET = new Set<string>(DATE_FORMATS);

/** A stored layout with everything it cannot be left out. */
export function readSectionLayout(raw: unknown): SectionLayout {
  if (!isRecord(raw)) return DEFAULT_SECTION_LAYOUT;
  const { column, direction } = isRecord(raw.sort) ? raw.sort : {};
  const sort: SectionSort | null = isColumn(column) && (direction === "asc" || direction === "desc") ? { column, direction } : null;
  return {
    order: columnsOf(raw.order, []),
    hidden: columnsOf(raw.hidden, DEFAULT_SECTION_LAYOUT.hidden),
    pinned: columnsOf(raw.pinned, DEFAULT_SECTION_LAYOUT.pinned),
    widths: isRecord(raw.widths)
      ? Object.fromEntries(
          Object.entries(raw.widths).filter((entry): entry is [string, number] => isColumn(entry[0]) && typeof entry[1] === "number" && Number.isFinite(entry[1])),
        )
      : {},
    sort,
    formats: isRecord(raw.formats)
      ? Object.fromEntries(Object.entries(raw.formats).filter((entry): entry is [string, DateFormat] => isColumn(entry[0]) && typeof entry[1] === "string" && FORMAT_SET.has(entry[1])))
      : {},
  };
}

function readAll(): Readonly<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SECTION_LAYOUT_STORAGE_KEY) ?? "{}");
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Layouts storage refused, kept for this session so the table still answers its own controls — as the task table's look does. */
let unsaved: Readonly<Record<string, SectionLayout>> = {};

const loadSectionLayout = (sectionId: string): SectionLayout => unsaved[sectionId] ?? readSectionLayout(readAll()[sectionId]);

let revision = 0;
const listeners = new Set<() => void>();
const getRevision = () => revision;

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

function store(sectionId: string, layout: SectionLayout): void {
  try {
    localStorage.setItem(SECTION_LAYOUT_STORAGE_KEY, JSON.stringify({ ...readAll(), [sectionId]: layout }));
    const { [sectionId]: _kept, ...rest } = unsaved;
    unsaved = rest;
  } catch {
    unsaved = { ...unsaved, [sectionId]: layout };
  }
  revision += 1;
  listeners.forEach((notify) => notify());
}

/** A section's table layout, and a way to change it. */
export function useSectionLayout(sectionId: string): [SectionLayout, (change: (layout: SectionLayout) => SectionLayout) => void] {
  const seen = useSyncExternalStore(subscribe, getRevision, getRevision);
  const layout = useMemo(() => loadSectionLayout(sectionId), [sectionId, seen]);
  const update = useCallback((change: (layout: SectionLayout) => SectionLayout) => store(sectionId, change(loadSectionLayout(sectionId))), [sectionId]);
  return [layout, update];
}
