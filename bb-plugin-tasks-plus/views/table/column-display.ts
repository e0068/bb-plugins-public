// Layer: views/table, pure. How a table column draws its values — the date
// format and the icon its header menu chooses — read from and written into
// the table's settings (shared/contract.ts tableSettingsSchema `columns`).
// Type-only: keeps contract.ts's runtime dependencies out of the frontend bundle.
import type { TableSettings } from "../../shared/contract.js";
import type { DateFormat, RowField } from "../../shared/enums.js";

export type ColumnDisplays = NonNullable<TableSettings["columns"]>;
export type ColumnDisplay = NonNullable<ColumnDisplays[RowField]>;

/** The columns of dates — the ones whose header menu offers a format. */
export const DATE_COLUMNS = ["startDate", "dueDate", "createdAt", "updatedAt"] as const satisfies readonly RowField[];
export type DateColumn = (typeof DATE_COLUMNS)[number];
const DATE_COLUMN_SET: ReadonlySet<RowField> = new Set<RowField>(DATE_COLUMNS);

/** The columns whose icon is decoration a header menu can switch, and whether it shows by default. */
const ICON_DEFAULTS: Partial<Record<RowField, boolean>> = {
  type: true,
  estimate: true,
  ...Object.fromEntries(DATE_COLUMNS.map((column) => [column, false])),
};

export const DEFAULT_DATE_FORMAT: DateFormat = "dateTime";

export const isDateColumn = (column: RowField): column is DateColumn => DATE_COLUMN_SET.has(column);

export const hasIconChoice = (column: RowField): boolean => ICON_DEFAULTS[column] !== undefined;

export const dateFormatOf = (displays: ColumnDisplays | undefined, column: RowField): DateFormat =>
  displays?.[column]?.format ?? DEFAULT_DATE_FORMAT;

export const iconShownOf = (displays: ColumnDisplays | undefined, column: RowField): boolean =>
  displays?.[column]?.icon ?? ICON_DEFAULTS[column] ?? false;

/** `displays` with `patch` laid over one column's choices; the rest untouched. */
export function withColumnDisplay(
  displays: ColumnDisplays | undefined,
  column: RowField,
  patch: ColumnDisplay,
): ColumnDisplays {
  return { ...displays, [column]: { ...displays?.[column], ...patch } };
}
