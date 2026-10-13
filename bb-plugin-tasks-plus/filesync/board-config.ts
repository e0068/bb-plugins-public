import { parseIcon } from "@bb-plugins/icon-catalog";
import { parseTableId, type TableId } from "./db-tables.js";
import { parseFields, type SectionField } from "../shared/section-fields.js";
import type { CatalogLabel } from "./label-catalog.js";

/**
 * A board's machine-local configuration: the record that used to be a row
 * in SQLite's `projects` table. What lives here is exactly what isn't in
 * any task file — display identity and the link to a repo folder. The
 * `Add synced folder` dialog (views/manage/add-folder-dialog.tsx) still
 * writes exactly these fields; only the storage underneath changed (see
 * decisions/tasks-files-are-the-store.md).
 */
export interface BoardConfig {
  id: string;
  name: string;
  prefix: string;
  color: string;
  /** Name of a catalog icon; a board without one is drawn with the default. */
  icon?: string;
  /** The labels added in Manage → Labels with their colours (filesync/label-catalog.ts); absent for none. */
  labels?: CatalogLabel[];
  /** The icon in each table column's header, by the column's field; absent for none. */
  columnIcons?: Record<string, string>;
  folderId: string | null;
  linkedBbProjectId: string | null;
  tasksFolder: string | null;
  /** The online database the board lives in; null for a board that lives in folders.
   *  `mirrorFolder` — the folder of this machine its records are mirrored into, absent or null for none;
   *  `table` — the table beside the task board this board shows, absent for the task board itself;
   *  `parent` — the section that table sits in, absent for a top section;
   *  `fields` — the section's fields beyond the defaults, as its database lists them, absent for none. */
  database: { url: string; mirrorFolder?: string | null; table?: TableId; parent?: TableId; fields?: SectionField[] } | null;
  createdAt: string;
}

export interface KvStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

const BOARDS_KEY = "boards";

export async function readBoardConfigs(kv: KvStore): Promise<BoardConfig[]> {
  // Records written before boards could live in a database carry no `database` key.
  const stored = (await kv.get<Array<Omit<BoardConfig, "database"> & { database?: BoardConfig["database"] }>>(BOARDS_KEY)) ?? [];
  // A table id that does not read as one would point the board at the task board's tables: such a board is left out.
  return stored
    .filter((board) => board.database?.table === undefined || parseTableId(board.database.table) !== null)
    .map((board) => withReadableColumnIcons(withReadableLabels({ ...board, database: board.database == null ? null : withReadableFields(withReadableParent(board.database)) })));
}

/** The board with the column icons of `icons` that read as icons; none — no `columnIcons` key. */
export function withColumnIcons({ columnIcons: _old, ...board }: BoardConfig, icons: unknown): BoardConfig {
  if (typeof icons !== "object" || icons === null) return board;
  const readable = Object.entries(icons).filter((entry): entry is [string, string] => typeof entry[1] === "string" && parseIcon(entry[1]) !== null);
  return readable.length === 0 ? board : { ...board, columnIcons: Object.fromEntries(readable) };
}

const withReadableColumnIcons = (board: BoardConfig): BoardConfig => withColumnIcons(board, board.columnIcons);

const isCatalogLabel = (label: unknown): label is CatalogLabel =>
  typeof label === "object" && label !== null &&
  typeof (label as CatalogLabel).name === "string" && typeof (label as CatalogLabel).color === "string";

/** A label's icon that does not read as an icon is dropped, the label stays. */
const withReadableIcon = ({ icon, ...label }: CatalogLabel): CatalogLabel =>
  typeof icon === "string" && parseIcon(icon) !== null ? { ...label, icon } : label;

/** Labels that do not read as a name and a colour are dropped; none left is no `labels` key. */
function withReadableLabels(board: BoardConfig): BoardConfig {
  if (board.labels === undefined) return board;
  const { labels, ...rest } = board;
  const readable = Array.isArray(labels) ? labels.filter(isCatalogLabel).map(withReadableIcon) : [];
  return readable.length === 0 ? rest : { ...rest, labels: readable };
}

/** A parent that does not read as a section id is dropped: the section is then a top one. */
function withReadableParent(database: NonNullable<BoardConfig["database"]>): NonNullable<BoardConfig["database"]> {
  if (database.parent === undefined || parseTableId(database.parent) !== null) return database;
  const { parent: _unreadable, ...rest } = database;
  return rest;
}

/** Fields that do not read as fields are dropped; none left is no `fields` key. */
function withReadableFields(database: NonNullable<BoardConfig["database"]>): NonNullable<BoardConfig["database"]> {
  if (database.fields === undefined) return database;
  const { fields, ...rest } = database;
  const readable = parseFields(fields);
  return readable.length === 0 ? rest : { ...rest, fields: readable };
}

export async function writeBoardConfigs(
  kv: KvStore,
  boards: readonly BoardConfig[],
): Promise<void> {
  await kv.set(BOARDS_KEY, boards);
}

/** Replaces the board with a matching `id`, or appends it when none match. */
export function upsertBoardConfig(
  boards: readonly BoardConfig[],
  board: BoardConfig,
): BoardConfig[] {
  const index = boards.findIndex((b) => b.id === board.id);
  if (index === -1) return [...boards, board];
  return boards.map((b, i) => (i === index ? board : b));
}

export function removeBoardConfig(
  boards: readonly BoardConfig[],
  id: string,
): BoardConfig[] {
  return boards.filter((b) => b.id !== id);
}

/**
 * The board (if any) whose `linkedBbProjectId` and `tasksFolder` match —
 * how a bb project + repo-relative path resolves back to a board, the file-
 * backed replacement for the SQL store's unique-prefix lookup by source.
 */
export function findBoardBySource(
  boards: readonly BoardConfig[],
  linkedBbProjectId: string,
  tasksFolder: string,
): BoardConfig | undefined {
  return boards.find(
    (b) =>
      b.linkedBbProjectId === linkedBbProjectId && b.tasksFolder === tasksFolder,
  );
}

/**
 * The board that already took a bb project — one board per bb project. The
 * board being written (`exceptBoardId`) does not count against itself, and an
 * unlinked board (`null`) takes nothing.
 */
export function linkTakenBy(
  boards: readonly BoardConfig[],
  bbProjectId: string | null,
  exceptBoardId?: string,
): BoardConfig | undefined {
  if (bbProjectId === null) return undefined;
  return boards.find((b) => b.linkedBbProjectId === bbProjectId && b.id !== exceptBoardId);
}

/** The refusal of a second board on a bb project, naming the board that holds it. */
export function linkTakenMessage(bbProjectId: string, holder: BoardConfig): string {
  return `bb project ${bbProjectId} is already linked to board ${holder.prefix} (${holder.name})`;
}

/**
 * The next task key number for a board: one past the highest number already
 * used by any file (main or worktree) — see decisions/tasks-files-are-the-
 * store.md. Computed fresh from the files themselves rather than a stored
 * counter, so there is nothing to keep in sync when a file is added or
 * removed by hand.
 */
export function nextTaskNumber(existingKeys: readonly string[], prefix: string): number {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, "i");
  const numbers = existingKeys
    .map((key) => pattern.exec(key)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number);
  return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}
