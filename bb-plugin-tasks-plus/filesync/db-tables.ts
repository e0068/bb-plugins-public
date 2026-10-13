import type { HranaRow } from "../remote/hrana.js";
import { parseFields, type SectionField } from "../shared/section-fields.js";

/**
 * The tables of a board database. The task board keeps the `tasks` and
 * `board` tables it always had, so a plugin of an older version still reads
 * and writes it; each table added beside it gets a pair of its own —
 * `rec_<id>` for its records, `head_<id>` for its name, prefix and change
 * counter — and a row in `tables`, the list every machine reads its tables
 * from (docs/specs/BBPL-900-…).
 */

declare const tableIdBrand: unique symbol;
/** Eight lowercase letters or digits: safe to put inside an SQL name as it is. */
export type TableId = string & { readonly [tableIdBrand]: true };

const TABLE_ID = /^[a-z0-9]{8}$/;
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export const parseTableId = (value: string): TableId | null => (TABLE_ID.test(value) ? (value as TableId) : null);

export function newTableId(random: () => number): TableId {
  const id = Array.from({ length: 8 }, () => ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)]).join("");
  return id as TableId;
}

export interface TableNames {
  records: string;
  head: string;
}

/** The SQL tables a repository reads and writes: the task board's for `null`, the table's own otherwise. */
export const tableNames = (table: TableId | null): TableNames =>
  table === null ? { records: "tasks", head: "board" } : { records: `rec_${table}`, head: `head_${table}` };

/** Where a repository's record paths start: a table's sit under the database address, apart from the task board's. */
export const tableRoot = (url: string, table: TableId | null): string =>
  table === null ? url : `${url.replace(/\/+$/, "")}/tables/${table}`;

/** A section of the database: its own pair of tables, a name, the section it sits in — none for a top one —
 *  and the fields its records were given beyond the defaults. */
export interface DbTable {
  id: TableId;
  name: string;
  parent: TableId | null;
  fields: SectionField[];
}

export const TABLES_SCHEMA = `CREATE TABLE IF NOT EXISTS tables (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
)`;

/** The column of a section's parent, added to a list made before sections nested: the database answers
 *  "duplicate column name" once it is there, which the repository takes for done. */
export const TABLES_PARENT_COLUMN = "ALTER TABLE tables ADD COLUMN parent TEXT";

/** The column of a section's fields, a JSON list of `{ name, type }`, added the same way. */
export const TABLES_FIELDS_COLUMN = "ALTER TABLE tables ADD COLUMN fields TEXT";

/** Columns a list made by an older plugin lacks: adding one that is there is not a failure. */
export const TABLES_ADDED_COLUMNS: ReadonlySet<string> = new Set([TABLES_PARENT_COLUMN, TABLES_FIELDS_COLUMN]);

export const LIST_TABLES = "SELECT id, name, parent, fields FROM tables ORDER BY created_at, id";

/** Puts one field at the end of a section's list inside the database, so two machines adding at once both land. */
export const APPEND_TABLE_FIELD = "UPDATE tables SET fields = json_insert(COALESCE(fields, '[]'), '$[#]', json(?)) WHERE id = ?";

/** Where in a section's list the field named by the second argument stands, in any case; null when it is not there. */
const FIELD_INDEX = "(SELECT key FROM json_each(tables.fields) WHERE lower(json_extract(value, '$.name')) = lower(?2) LIMIT 1)";
const OPTIONS_PATH = `'$[' || ${FIELD_INDEX} || '].options'`;

/** Puts an option (?3) at the end of the options of a declared field (?2) of a section (?1), inside the database. */
export const ADD_FIELD_OPTION = `UPDATE tables SET fields = json_set(fields, ${OPTIONS_PATH}, json_insert(COALESCE(json_extract(fields, ${OPTIONS_PATH}), json('[]')), '$[#]', ?3)) WHERE id = ?1 AND ${FIELD_INDEX} IS NOT NULL`;

/** Takes an option (?3), in any case, out of the options of a declared field (?2) of a section (?1). */
export const REMOVE_FIELD_OPTION = `UPDATE tables SET fields = json_set(fields, ${OPTIONS_PATH}, (SELECT json_group_array(value) FROM json_each(tables.fields, ${OPTIONS_PATH}) WHERE lower(value) <> lower(?3))) WHERE id = ?1 AND ${FIELD_INDEX} IS NOT NULL`;

export const RENAME_TABLE = "UPDATE tables SET name = ? WHERE id = ?";

/** A section's row and its pair of tables: what deleting it takes out of the database. */
export const deleteTableSteps = (id: TableId): { sql: string; args?: string[] }[] => {
  const names = tableNames(id);
  return [
    { sql: "DELETE FROM tables WHERE id = ?", args: [id] },
    { sql: `DROP TABLE IF EXISTS ${names.records}` },
    { sql: `DROP TABLE IF EXISTS ${names.head}` },
  ];
};

/** A section and every section inside it, at any depth: what deleting it takes along. */
export const subtreeOf = (tables: readonly DbTable[], id: TableId): TableId[] => [
  id,
  ...tables.filter((table) => table.parent === id && table.id !== id).flatMap((child) => subtreeOf(tables, child.id)),
];

const fieldsOf = (raw: unknown): SectionField[] => {
  if (typeof raw !== "string") return [];
  try {
    return parseFields(JSON.parse(raw));
  } catch {
    return [];
  }
};

/** The list of tables as the database holds it; a row that cannot be read is left out,
 *  a parent that cannot be read — or names the section itself — makes a top section,
 *  and fields that cannot be read are no fields. */
export const decodeTables = (rows: readonly HranaRow[]): DbTable[] =>
  rows.flatMap((row) => {
    const id = typeof row.id === "string" ? parseTableId(row.id) : null;
    const parent = typeof row.parent === "string" ? parseTableId(row.parent) : null;
    return id !== null && typeof row.name === "string" ? [{ id, name: row.name, parent: parent === id ? null : parent, fields: fieldsOf(row.fields) }] : [];
  });
