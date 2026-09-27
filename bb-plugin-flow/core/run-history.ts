// Порядок строк истории прогонов: ключи kv приходят в своём порядке, а владелец ищет последние прогоны.

type Ordered = { briefId: string; summary: { finishedAt: string } };

const freshFirst = (a: Ordered, b: Ordered): number =>
  Date.parse(b.summary.finishedAt) - Date.parse(a.summary.finishedAt) || (a.briefId < b.briefId ? -1 : a.briefId > b.briefId ? 1 : 0);

/** Свежие прогоны сверху; одновременно закончившиеся — по брифу, чтобы порядок не зависел от порядка ключей. */
export const historyOrder = <T extends Ordered>(entries: readonly T[]): T[] => [...entries].sort(freshFirst);

/** Колонки шапки истории в порядке слева направо. */
export const HISTORY_COLUMNS = ["title", "project", "flow", "started", "finished", "minutes", "cost"] as const;
export type HistoryColumn = (typeof HISTORY_COLUMNS)[number];
export type HistorySort = { readonly column: HistoryColumn; readonly direction: "asc" | "desc" };

/** Без выбора владельца — порядок сервера: свежие по окончанию сверху. */
export const DEFAULT_HISTORY_SORT: HistorySort = { column: "finished", direction: "desc" };

type Sortable = Ordered & { flowName?: string; project?: string | null; summary: { startedAt: string; minutes: number; cost: number } };

const cellOf = <T extends Sortable>(entry: T, column: HistoryColumn, titleOf: (entry: T) => string): string | number => {
  switch (column) {
    case "title":
      return titleOf(entry);
    case "project":
      return entry.project ?? "";
    case "flow":
      return entry.flowName ?? "";
    case "started":
      return Date.parse(entry.summary.startedAt);
    case "finished":
      return Date.parse(entry.summary.finishedAt);
    case "minutes":
      return entry.summary.minutes;
    case "cost":
      return entry.summary.cost;
  }
};

const compareCells = (a: string | number, b: string | number): number =>
  typeof a === "string" && typeof b === "string" ? a.localeCompare(b) : Number(a) - Number(b);

/**
 * Строки истории по колонке шапки. Название сравнивается тем, что видит
 * владелец, — его подпись у удалённого треда знает только интерфейс.
 * Равные по колонке — свежие сверху, как без сортировки.
 */
export const sortHistory = <T extends Sortable>(entries: readonly T[], sort: HistorySort, titleOf: (entry: T) => string): T[] => {
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => sign * compareCells(cellOf(a, sort.column, titleOf), cellOf(b, sort.column, titleOf)) || freshFirst(a, b));
};

const TEXT_COLUMNS: ReadonlySet<HistoryColumn> = new Set(["title", "project", "flow"]);

/** Первый клик по колонке: текст — от А, время и числа — от большего; повторный — в обратную сторону. */
export const nextHistorySort = (current: HistorySort, column: HistoryColumn): HistorySort =>
  current.column === column
    ? { column, direction: current.direction === "asc" ? "desc" : "asc" }
    : { column, direction: TEXT_COLUMNS.has(column) ? "asc" : "desc" };

/**
 * Id flow строки истории, пока flow жив: сохранённый в итоге, а у итогов, замороженных до того, как id начали хранить, —
 * живого flow с тем же названием. Сохранённый id удалённого flow названием не подменяется: это был другой flow.
 */
export const liveFlowId = (flows: ReadonlyArray<{ id: string; name: string }>, id: string | undefined, name: string | undefined): string | undefined =>
  (id === undefined ? flows.find((flow) => flow.name === name) : flows.find((flow) => flow.id === id))?.id;
