import { ROW_FIELDS } from "../shared/enums.js";
import { savedViewSchema, type SavedView } from "../shared/contract.js";

const KNOWN_ROW_FIELDS = new Set<string>(ROW_FIELDS);

/**
 * Drops column entries naming a field that has since been retired (`tokens`,
 * for one). This runs BEFORE the schema, not after: the field list is a zod
 * enum, so a retired name makes the whole record fail to parse — and a record
 * that fails to parse is not merely hidden, it is dropped on load and erased
 * from kv by the next write (`createKvCollection` persists the whole array).
 */
function withKnownFields(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const record = raw as Record<string, unknown>;
  // Current shape keeps columns under `fields`, the first pass under `config`.
  const key = "fields" in record ? "fields" : "config";
  const columns = record[key];
  if (typeof columns !== "object" || columns === null) return raw;
  const list = (columns as Record<string, unknown>).fields;
  if (!Array.isArray(list)) return raw;
  return {
    ...record,
    [key]: {
      ...(columns as Record<string, unknown>),
      fields: list.filter(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          KNOWN_ROW_FIELDS.has(String((entry as Record<string, unknown>).field)),
      ),
    },
  };
}

/**
 * A view saved before the parent filter holds an epic filter in its place.
 * The epic filter is gone, so it is dropped — the view keeps everything else
 * and shows the tasks it did before minus that narrowing. This runs before
 * the schema for the same reason as `withKnownFields`: the filters are
 * strict, and a key they no longer know would drop the whole view.
 */
function withoutEpicFilter(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const record = raw as Record<string, unknown>;
  const filters = record.filters;
  if (typeof filters !== "object" || filters === null || !("epics" in filters)) return raw;
  const { epics: _dropped, ...rest } = filters as Record<string, unknown>;
  return { ...record, filters: { parents: [], ...rest } };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** A record without one key; anything else as it came. */
const without = (value: unknown, key: string): unknown => {
  if (!isRecord(value) || !(key in value)) return value;
  const { [key]: _dropped, ...rest } = value;
  return rest;
};

/** A sort by the retired Epic field reads as none: null for a table, the manual order for a view. */
const sortOffEpic = (sort: unknown, none: null | "manual"): unknown => (isRecord(sort) && sort.column === "epic" ? none : sort);

/** A grouping by the retired Epic field falls back on Status, and its Epic column settings go. */
function groupingOffEpic(grouping: unknown): unknown {
  if (!isRecord(grouping)) return grouping;
  return {
    ...grouping,
    ...(grouping.groupBy === "epic" ? { groupBy: "status" } : {}),
    ...(isRecord(grouping.columns) ? { columns: without(grouping.columns, "epic") } : {}),
  };
}

/** A table's settings with the retired Epic field out of its sort, grouping, widths and pins. */
function tableOffEpic(table: unknown): unknown {
  if (!isRecord(table)) return table;
  return {
    ...table,
    ...("sort" in table ? { sort: sortOffEpic(table.sort, null) } : {}),
    ...(table.groupBy === "epic" ? { groupBy: "status" } : {}),
    ...(isRecord(table.widths) ? { widths: without(table.widths, "epic") } : {}),
    ...(Array.isArray(table.pinned) ? { pinned: table.pinned.filter((field) => field !== "epic") } : {}),
  };
}

/**
 * A view saved while Epic was a field may filter, sort or group by it. The
 * field is gone — a task's place under an epic reads through Parent — so each
 * of those falls away and the view keeps the rest; its field list loses Epic
 * in `withKnownFields`. Before the schema, for the same reason as there.
 */
function withoutEpicField(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const filters = raw.filters;
  return {
    ...raw,
    ...(isRecord(filters) && isRecord(filters.values) ? { filters: { ...filters, values: without(filters.values, "epic") } } : {}),
    ...("sort" in raw ? { sort: sortOffEpic(raw.sort, "manual") } : {}),
    ...("board" in raw ? { board: groupingOffEpic(raw.board) } : {}),
    ...("table" in raw ? { table: tableOffEpic(raw.table) } : {}),
  };
}

/**
 * Reads a stored saved-view record, whatever shape it was written in.
 *
 * The first pass (BP-63) stored `{ id, scope, name, config, createdAt }`,
 * where `scope` was an opaque partition key the client alone understood:
 * "all", "active", "waiting", "project:<id>", "board:<id>". A view is now a
 * navigation entry that carries the whole list — project, filters, sort and
 * columns — so those records are translated rather than dropped: losing a
 * saved view silently is worse than parsing a grammar we wrote ourselves.
 * See docs/decisions/saved-view-config-migration.md.
 *
 * A record that cannot be read either way yields `null`; the caller skips it.
 */
export function migrateSavedView(rawRecord: unknown): SavedView | null {
  const raw = withoutEpicField(withoutEpicFilter(withKnownFields(rawRecord)));
  const current = savedViewSchema.safeParse(raw);
  if (current.success) return current.data;

  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const surface = readScope(record.scope);
  if (surface === null) return null;

  const migrated = savedViewSchema.safeParse({
    id: record.id,
    version: 2,
    name: record.name,
    projectId: surface.projectId,
    listScope: surface.listScope,
    filters: NO_FILTERS,
    sort: "manual",
    fields: record.config,
    createdAt: record.createdAt,
  });
  return migrated.success ? migrated.data : null;
}

const NO_FILTERS = {
  statuses: [],
  priorities: [],
  types: [],
  estimates: [],
  labelNames: [],
  assignees: [],
  parents: [],
} as const;

interface Surface {
  projectId: string | null;
  listScope: "active" | "waiting" | null;
}

/**
 * The first pass's scope grammar. The client still writes the same strings as
 * preference keys (`listFieldScope` in views/common/row-field-preference.ts) and
 * reads them back in `surfaceOf` (views/common/view-state.ts) — this is the one
 * place that reads the *stored view* form of it, and it goes away with the
 * last first-pass record.
 */
function readScope(scope: unknown): Surface | null {
  if (typeof scope !== "string") return null;
  if (scope === "all") return { projectId: null, listScope: null };
  if (scope === "active") return { projectId: null, listScope: "active" };
  if (scope === "waiting") return { projectId: null, listScope: "waiting" };

  const [head, ...rest] = scope.split(":");
  const id = rest.join(":");
  if ((head === "project" || head === "board") && id !== "") {
    return { projectId: id, listScope: null };
  }
  return null;
}
