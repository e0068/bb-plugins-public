import type { HranaClient, HranaError, HranaResult, HranaRow, HranaStep, HranaStepResult, HranaValue, UnreachableCause } from "../remote/hrana.js";
import type { TaskStatus } from "../db/types.js";
import { applyRows, INITIAL_LINK, nextLink, refusedLink, taskFilePath, tokenlessLink, type LinkState, type Mirror, type TaskRow } from "./db-mirror.js";
import { parseTaskFile } from "./task-file.js";
import {
  ADD_FIELD_OPTION,
  APPEND_TABLE_FIELD,
  decodeTables,
  deleteTableSteps,
  LIST_TABLES,
  REMOVE_FIELD_OPTION,
  RENAME_TABLE,
  SET_FIELD_ICON,
  SET_OPTION_ICON,
  subtreeOf,
  TABLES_ADDED_COLUMNS,
  TABLES_FIELDS_COLUMN,
  TABLES_PARENT_COLUMN,
  TABLES_SCHEMA,
  tableNames,
  tableRoot,
  type DbTable,
  type TableId,
  type TableNames,
} from "./db-tables.js";
import type { SectionField } from "../shared/section-fields.js";
import type { TaskPlacement } from "./placement.js";
import {
  DatabaseAuthFailed,
  DatabaseTokenMissing,
  DatabaseUnreachable,
  outOfReach,
  WriteConflict,
  type RepoFile,
  type RepoState,
  type RepoWrite,
  type TaskRepo,
} from "./task-repo.js";

/**
 * A board kept in a libSQL database: one `tasks` table whose rows carry the
 * full text of the same task file a folder holds, and a one-row `board` table
 * with the board's name, prefix and change counter. Reads come from an
 * in-memory mirror that a poll keeps up with the counter; every write is one
 * `batch` — a transaction with a conditional update by row version — so two
 * machines can neither overwrite each other nor issue one key twice.
 */

export interface DbRepoOptions {
  url: string;
  /** The table beside the task board this repository keeps; absent — the task board itself. */
  table?: TableId;
  onChange?: () => void;
  /** A write of this machine landed: the mirror already holds it, so no poll will tell it as a change. */
  onWrite?: () => void;
  onStateChange?: (state: RepoState) => void;
  /** A lost attempt with its cause: the first after a live link, and each whose cause differs from the one told before it. */
  onLinkLost?: (why: UnreachableCause) => void;
  pollMs?: number;
  now?: () => Date;
}

export interface BoardRow {
  name: string;
  prefix: string;
}

export interface DbRepo extends TaskRepo {
  readBoard(): Promise<BoardRow | null>;
  writeBoard(row: BoardRow): Promise<void>;
  /** Changes the board's prefix and keeps its name. */
  writePrefix(prefix: string): Promise<void>;
  /** How many tasks the mirror holds. */
  count(): number;
  /** The text of every live record, by slug, as the last poll or write left them. */
  snapshot(): ReadonlyMap<string, string>;
  /** Whether the database has answered once: before that the snapshot is empty, not the board. */
  loaded(): boolean;
  /** The tables beside the task board, as the last poll left them; only the task board's repository reads them. */
  tables(): readonly DbTable[];
  /** Adds a table beside the task board and tells every machine on the next poll. */
  addTable(id: TableId, name: string, parent: TableId | null): Promise<DbTable>;
  /** Gives a table one more field and tells every machine on the next poll. */
  addTableField(id: TableId, field: SectionField): Promise<void>;
  /** Adds an option to a declared Select or Tags field of a table, or takes one away. */
  changeFieldOption(id: TableId, field: string, option: string, change: "add" | "remove"): Promise<void>;
  /** Gives a declared field of a section, or one option of it, an icon; null takes it off. */
  setFieldIcon(id: TableId, field: string, option: string | null, icon: string | null): Promise<void>;
  /** Gives a table a new name. */
  renameTable(id: TableId, name: string): Promise<void>;
  /** Takes a table, its records and every table inside it out of the database. */
  deleteTable(id: TableId): Promise<void>;
  /** Polls the database every `pollMs` until `stop()`. */
  start(): void;
  stop(): void;
}

const DEFAULT_POLL_MS = 2000;
const SCHEMA_VERSION = 1;

const schemaSteps = (names: TableNames): readonly HranaStep[] => [
  {
    sql: `CREATE TABLE IF NOT EXISTS ${names.records} (
      slug TEXT PRIMARY KEY,
      key TEXT UNIQUE,
      status TEXT NOT NULL,
      assignee TEXT,
      epic TEXT,
      content TEXT NOT NULL,
      version INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  },
  {
    sql: `CREATE TABLE IF NOT EXISTS ${names.head} (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      seq INTEGER NOT NULL,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL,
      schema INTEGER NOT NULL
    )`,
  },
  { sql: `INSERT OR IGNORE INTO ${names.head} (id, seq, name, prefix, schema) VALUES (1, 0, '', '', ?)`, args: [SCHEMA_VERSION] },
  // The list of tables lives beside the task board; creating it is harmless for a table's repository too.
  { sql: TABLES_SCHEMA },
  { sql: TABLES_PARENT_COLUMN },
  { sql: TABLES_FIELDS_COLUMN },
];

/** A schema step that failed for real: a column the list already has is not a failure. */
const schemaFailure = (step: HranaStepResult, sent: HranaStep | undefined): boolean =>
  step.kind === "error" && !(sent !== undefined && TABLES_ADDED_COLUMNS.has(sent.sql) && /duplicate column/i.test(step.message));

const TASK_COLUMNS = "slug, key, status, assignee, epic, content, version, seq, deleted, created_at, updated_at";
const nextSeq = (names: TableNames): string => `(SELECT seq FROM ${names.head}) + 1`;

// --- decoding what the database says ---------------------------------------

const text = (value: HranaValue | undefined): string | null => (typeof value === "string" ? value : null);
const integer = (value: HranaValue | undefined): number | null => (typeof value === "number" ? value : null);

function decodeTaskRow(row: HranaRow): TaskRow | null {
  const slug = text(row.slug);
  const status = text(row.status);
  const content = text(row.content);
  const version = integer(row.version);
  const seq = integer(row.seq);
  const deleted = integer(row.deleted);
  const created = text(row.created_at);
  const updated = text(row.updated_at);
  if (slug === null || status === null || content === null || version === null || seq === null || deleted === null || created === null || updated === null) {
    return null;
  }
  return {
    slug,
    key: text(row.key),
    status,
    assignee: text(row.assignee),
    epic: text(row.epic),
    content,
    version,
    seq,
    deleted,
    created_at: created,
    updated_at: updated,
  };
}

/** Rows as tasks; the ones that do not read as a task are left out of the mirror and named in `unreadable`, for the shell to report. */
interface DecodedRows {
  rows: TaskRow[];
  unreadable: string[];
}

const decodeTaskRows = (rows: readonly HranaRow[]): DecodedRows =>
  rows.reduce<DecodedRows>((acc, row) => {
    const decoded = decodeTaskRow(row);
    return decoded === null
      ? { rows: acc.rows, unreadable: [...acc.unreadable, String(row.slug)] }
      : { rows: [...acc.rows, decoded], unreadable: acc.unreadable };
  }, { rows: [], unreadable: [] });

const NO_ROWS: DecodedRows = { rows: [], unreadable: [] };

/** The shell's one line about rows left out of the mirror. */
function reportUnreadable(unreadable: readonly string[]): void {
  if (unreadable.length > 0) console.warn(`tasks-plus: rows of the tasks table that do not read as tasks are left out (slugs: ${unreadable.join(", ")})`);
}

interface BoardHead extends BoardRow {
  seq: number;
}

const EMPTY_HEAD: BoardHead = { seq: 0, name: "", prefix: "" };

function decodeBoardHead(rows: readonly HranaRow[]): BoardHead {
  const [row] = rows;
  if (row === undefined) return EMPTY_HEAD;
  return { seq: integer(row.seq) ?? 0, name: text(row.name) ?? "", prefix: text(row.prefix) ?? "" };
}

/** A path of the virtual tree back to its slug: `<address>/…/<status>/<slug>.md`. */
const slugOfPath = (filePath: string): string => (filePath.split("/").pop() ?? "").replace(/\.md$/, "");

// --- what a write is --------------------------------------------------------

/** The two constraints of the table name what a refused insert collided with. */
function conflictReason(error: { code: string; message: string }): "version" | "key" | "slug" | null {
  // Another machine's transaction held the database: nothing was written, so it is retried like a lost race.
  if (error.code.startsWith("SQLITE_BUSY")) return "version";
  if (/\.slug\b/.test(error.message) || error.code === "SQLITE_CONSTRAINT_PRIMARYKEY") return "slug";
  if (/\.key\b/.test(error.message) || error.code === "SQLITE_CONSTRAINT_UNIQUE") return "key";
  return null;
}

interface TransactionPlan {
  steps: HranaStep[];
  /** The step whose changed-row count says whether the write landed. */
  main: number;
  commit: number;
  read: number;
}

const ok = (step: number) => ({ type: "ok", step }) as const;

/**
 * BEGIN IMMEDIATE, the statements of the body each running only if the one
 * before it succeeded, a bump of the board's counter if the last of them
 * changed a row, COMMIT, ROLLBACK if there was no commit, and a read-back of
 * the rows touched. A failed statement skips the rest and rolls back.
 */
function transaction(names: TableNames, body: readonly HranaStep[], slugs: readonly string[]): TransactionPlan {
  const begin: HranaStep = { sql: "BEGIN IMMEDIATE" };
  const chained = body.map((step, index) => ({ ...step, condition: ok(index) }));
  /** BEGIN is step 0, so the last statement of the body sits at step `body.length`. */
  const main = body.length;
  const bump: HranaStep = { sql: `UPDATE ${names.head} SET seq = seq + 1 WHERE changes() > 0`, condition: ok(main) };
  const bumpAt = main + 1;
  const commitStep: HranaStep = { sql: "COMMIT", condition: ok(bumpAt) };
  const commitAt = bumpAt + 1;
  const rollback: HranaStep = { sql: "ROLLBACK", condition: { type: "not", cond: ok(commitAt) } };
  const read: HranaStep = {
    sql: `SELECT ${TASK_COLUMNS} FROM ${names.records} WHERE slug IN (${slugs.map(() => "?").join(", ")})`,
    args: slugs,
    condition: ok(commitAt),
  };
  const steps: HranaStep[] = [begin, ...chained, bump, commitStep, rollback, read];
  return { steps, main, commit: commitAt, read: steps.indexOf(read) };
}

type Outcome =
  | { kind: "committed"; decoded: DecodedRows }
  | { kind: "conflict"; reason: "version" | "key" | "slug" }
  | { kind: "failed"; message: string };

function interpret(results: readonly HranaStepResult[], plan: TransactionPlan): Outcome {
  const committed = results[plan.commit];
  if (committed?.kind === "ok") {
    const main = results[plan.main];
    if (main?.kind === "ok" && main.affectedRowCount === 0) return { kind: "conflict", reason: "version" };
    const read = results[plan.read];
    return { kind: "committed", decoded: read?.kind === "ok" ? decodeTaskRows(read.rows) : NO_ROWS };
  }
  const failed = results.slice(0, plan.commit).find((step): step is Extract<HranaStepResult, { kind: "error" }> => step.kind === "error");
  if (failed === undefined) return { kind: "failed", message: "the write did not commit" };
  const reason = conflictReason(failed);
  return reason === null ? { kind: "failed", message: `${failed.code}: ${failed.message}` } : { kind: "conflict", reason };
}

/** A write to the table by what it does to the task's slug. */
type Plan =
  | { kind: "create" }
  | { kind: "update"; slug: string }
  | { kind: "rename"; from: string };

function planOf(input: RepoWrite): Plan {
  if (input.previousPath === undefined) return { kind: "create" };
  const from = slugOfPath(input.previousPath);
  return from === input.slug ? { kind: "update", slug: from } : { kind: "rename", from };
}

/** ` AND version = ?` when the caller knows which version it read. */
const versionGuard = (expected: number | undefined): { sql: string; args: HranaValue[] } =>
  expected === undefined ? { sql: "", args: [] } : { sql: " AND version = ?", args: [expected] };

interface NewRow {
  slug: string;
  key: string | null;
  status: TaskStatus;
  placement: TaskPlacement;
  content: string;
  createdAt: string;
  updatedAt: string;
}

/** An epic only lives under an assignee. */
const epicOf = (placement: TaskPlacement): string | null => (placement.assignee === null ? null : placement.epic);

const rowValues = (row: NewRow): HranaValue[] => [
  row.slug,
  row.key,
  row.status,
  row.placement.assignee,
  epicOf(row.placement),
  row.content,
  row.createdAt,
  row.updatedAt,
];

const tombstonePurge = (names: TableNames, slug: string): HranaStep => ({ sql: `DELETE FROM ${names.records} WHERE slug = ? AND deleted = 1`, args: [slug] });

const insertStep = (names: TableNames, row: NewRow, onlyIfPreviousChanged: boolean): HranaStep => ({
  sql: onlyIfPreviousChanged
    ? `INSERT INTO ${names.records} (${TASK_COLUMNS}) SELECT ?, ?, ?, ?, ?, ?, 1, ${nextSeq(names)}, 0, ?, ? WHERE changes() > 0`
    : `INSERT INTO ${names.records} (${TASK_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, 1, ${nextSeq(names)}, 0, ?, ?)`,
  args: rowValues(row),
});

const updateStep = (names: TableNames, row: NewRow, expected: number | undefined): HranaStep => {
  const guard = versionGuard(expected);
  return {
    sql: `UPDATE ${names.records} SET key = ?, status = ?, assignee = ?, epic = ?, content = ?, version = version + 1, seq = ${nextSeq(names)}, updated_at = ? WHERE slug = ? AND deleted = 0${guard.sql}`,
    args: [row.key, row.status, row.placement.assignee, epicOf(row.placement), row.content, row.updatedAt, row.slug, ...guard.args],
  };
};

/** Marks a row deleted and frees its key, in the same stroke as whatever replaces it. */
const tombstoneStep = (names: TableNames, slug: string, expected: number | undefined, updatedAt: string): HranaStep => {
  const guard = versionGuard(expected);
  return {
    sql: `UPDATE ${names.records} SET deleted = 1, key = NULL, version = version + 1, seq = ${nextSeq(names)}, updated_at = ? WHERE slug = ? AND deleted = 0${guard.sql}`,
    args: [updatedAt, slug, ...guard.args],
  };
};

export function failureOf(error: HranaError): Error {
  switch (error.kind) {
    case "unreachable":
      return new DatabaseUnreachable(error.why);
    case "auth":
      return new DatabaseAuthFailed();
    case "no-token":
      return new DatabaseTokenMissing();
    case "sql":
      return new Error(`database error ${error.code}: ${error.message}`);
  }
}

function sameState(a: RepoState, b: RepoState): boolean {
  return a.kind === b.kind && (a.kind === "live" || (b.kind !== "live" && a.since === b.since));
}

/** The text of each live row by slug, kept beside the mirror: the mirror holds parsed files, and `readText` must hand back the text itself. Later `seq` wins, as in `applyRows`. */
function applyTexts(texts: ReadonlyMap<string, string>, rows: readonly TaskRow[]): ReadonlyMap<string, string> {
  const next = new Map(texts);
  for (const row of [...rows].sort((a, b) => a.seq - b.seq)) {
    if (row.deleted === 0) next.set(row.slug, row.content);
    else next.delete(row.slug);
  }
  return next;
}

const sameTables = (a: readonly DbTable[], b: readonly DbTable[]): boolean =>
  a.length === b.length &&
  a.every((entry, index) => {
    const other = b[index];
    return other !== undefined && entry.id === other.id && entry.name === other.name && entry.parent === other.parent && JSON.stringify(entry.fields) === JSON.stringify(other.fields);
  });

/** Whether the tasks a mirror holds differ: a task added, gone, or written again. */
function mirrorChanged(before: Mirror, after: Mirror): boolean {
  if (before.size !== after.size) return true;
  return [...after].some(([slug, file]) => {
    const known = before.get(slug);
    return known === undefined || known.revision !== file.revision || known.updatedAt !== file.updatedAt || known.filePath !== file.filePath;
  });
}

/**
 * The board a database holds, read without opening a repository: one query,
 * no mirror of its tasks. A database never connected has no board table yet,
 * and a refused statement reads as "no board"; a lost link or a refused token
 * is the failure itself.
 */
export async function peekBoard(client: HranaClient): Promise<HranaResult<BoardRow | null>> {
  const result = await client.execute("SELECT name, prefix FROM board WHERE id = 1");
  if (!result.ok) return result.error.kind === "sql" ? { ok: true, value: null } : result;
  const head = decodeBoardHead(result.value.rows);
  return { ok: true, value: head.name === "" && head.prefix === "" ? null : { name: head.name, prefix: head.prefix } };
}

export function createDbRepo(client: HranaClient, options: DbRepoOptions): DbRepo {
  const table = options.table ?? null;
  const names = tableNames(table);
  /** Where the paths of this repository's records start: the address itself for the task board. */
  const url = tableRoot(options.url, table);
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const now = options.now ?? (() => new Date());

  let mirror: Mirror = new Map();
  let texts: ReadonlyMap<string, string> = new Map();
  let board: BoardRow = { name: "", prefix: "" };
  let tables: readonly DbTable[] = [];
  let lastSeq = -1;
  let loaded = false;
  let schemaReady = false;
  let link: LinkState = INITIAL_LINK;
  /** The cause last given to `onLinkLost`, so a down link does not tell the same one on every poll. */
  let toldCause: UnreachableCause["cause"] | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let polling = false;
  let queue: Promise<unknown> = Promise.resolve();

  /** The version the mirror holds of the task a write replaces, when the caller did not say which it read. */
  function knownRevision(plan: Plan): number | undefined {
    if (plan.kind === "create") return undefined;
    return mirror.get(plan.kind === "update" ? plan.slug : plan.from)?.revision ?? undefined;
  }

  /** One thing at a time on the mirror: a poll never lands over a write it did not see. */
  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const run = queue.then(operation);
    queue = run.catch(() => undefined);
    return run;
  }

  function touch(succeeded: boolean): void {
    move(nextLink(link, { ok: succeeded, at: now().toISOString() }));
  }

  function move(next: LinkState): void {
    const moved = !sameState(link.state, next.state);
    link = next;
    if (moved) options.onStateChange?.(next.state);
  }

  /** The value, or the failure as the error the port promises; a lost link is counted.
   *  A network that does not answer moves the link toward offline, a refused
   *  token makes it refused, no token to send makes it tokenless; a refused
   *  statement is the database answering. */
  function unwrap<T>(result: HranaResult<T>): T {
    if (result.ok) return result.value;
    const { error } = result;
    if (error.kind === "unreachable") {
      if (link.state.kind === "live" || error.why.cause !== toldCause) {
        toldCause = error.why.cause;
        options.onLinkLost?.(error.why);
      }
      touch(false);
    }
    if (error.kind === "auth") move(refusedLink(link, now().toISOString()));
    if (error.kind === "no-token") move(tokenlessLink(link, now().toISOString()));
    throw failureOf(error);
  }

  /** Changes the list of tables with the counter's move, in one transaction — a change no poll is told of would
   *  never show elsewhere — then reads the list back. The first statement must find its section. */
  function changeTables(statements: readonly HranaStep[]): Promise<void> {
    return serialized(async () => {
      await ready();
      const last = statements.length;
      const steps = unwrap(
        await client.batch([
          { sql: "BEGIN IMMEDIATE" },
          ...statements.map((statement, index) => ({ ...statement, condition: { type: "ok" as const, step: index } })),
          { sql: `UPDATE ${names.head} SET seq = seq + 1 WHERE id = 1`, condition: { type: "ok", step: last } },
          { sql: "COMMIT", condition: { type: "ok", step: last + 1 } },
          { sql: "ROLLBACK", condition: { type: "not", cond: { type: "ok", step: last + 2 } } },
        ]),
      );
      const failed = steps.slice(0, last + 3).find((step) => step.kind === "error");
      if (failed?.kind === "error") throw new Error(`database error ${failed.code}: ${failed.message}`);
      const first = steps[1];
      if (first?.kind === "ok" && first.affectedRowCount === 0) throw new Error("the section or its field is not in the database");
      tables = decodeTables(unwrap(await client.execute(LIST_TABLES)).rows);
    });
  }

  async function ensureSchema(): Promise<void> {
    if (schemaReady) return;
    const sent = schemaSteps(names);
    const steps = unwrap(await client.batch(sent));
    const failed = steps.find((step, index) => schemaFailure(step, sent[index]));
    if (failed?.kind === "error") throw new Error(`database error ${failed.code}: ${failed.message}`);
    schemaReady = true;
  }

  async function pull(): Promise<void> {
    await ensureSchema();
    const head = decodeBoardHead(unwrap(await client.execute(`SELECT seq, name, prefix FROM ${names.head} WHERE id = 1`)).rows);
    const moved = head.seq > lastSeq;
    const { rows: changed, unreadable } = moved
      ? decodeTaskRows(unwrap(await client.execute(`SELECT ${TASK_COLUMNS} FROM ${names.records} WHERE seq > ? ORDER BY seq`, [lastSeq])).rows)
      : NO_ROWS;
    // Adding a table moves the task board's counter, so its list is read only when the counter moved.
    const nextTables = table === null && moved ? decodeTables(unwrap(await client.execute(LIST_TABLES)).rows) : tables;
    reportUnreadable(unreadable);
    const nextMirror = applyRows(mirror, url, changed);
    texts = applyTexts(texts, changed);
    const somethingNew =
      mirrorChanged(mirror, nextMirror) || head.name !== board.name || head.prefix !== board.prefix || !sameTables(tables, nextTables);
    mirror = nextMirror;
    tables = nextTables;
    board = { name: head.name, prefix: head.prefix };
    lastSeq = changed.reduce((latest, row) => Math.max(latest, row.seq), Math.max(lastSeq, head.seq));
    loaded = true;
    touch(true);
    if (somethingNew) options.onChange?.();
  }

  /** A write needs a link that is not known to be down, and a mirror to write against. */
  async function ready(): Promise<void> {
    if (link.state.kind === "refused") throw new DatabaseAuthFailed();
    if (link.state.kind === "no-token") throw new DatabaseTokenMissing();
    if (link.state.kind === "offline") throw new DatabaseUnreachable();
    if (!loaded && link.state.kind !== "live") throw new DatabaseUnreachable();
    if (!loaded) await pull();
  }

  async function commit(plan: TransactionPlan): Promise<TaskRow[]> {
    const outcome = interpret(unwrap(await client.batch(plan.steps)), plan);
    switch (outcome.kind) {
      case "committed":
        reportUnreadable(outcome.decoded.unreadable);
        mirror = applyRows(mirror, url, outcome.decoded.rows);
        texts = applyTexts(texts, outcome.decoded.rows);
        options.onWrite?.();
        return outcome.decoded.rows;
      case "conflict":
        throw new WriteConflict(outcome.reason);
      case "failed":
        throw new Error(`database error ${outcome.message}`);
    }
  }

  function sync(): Promise<void> {
    return serialized(pull);
  }

  /** A read needs the mirror. The first read tries the database once; after a
   *  failed try it answers at once instead of waiting out the timeout again —
   *  the poll keeps trying, and a lookup across every board must not stall on
   *  one dark database. */
  async function loadedMirror(): Promise<void> {
    if (loaded) return;
    if (link.state.kind === "refused") throw new DatabaseAuthFailed();
    if (link.state.kind === "no-token") throw new DatabaseTokenMissing();
    if (link.state.kind !== "live") throw new DatabaseUnreachable();
    await sync();
  }

  const repo: DbRepo = {
    async list() {
      await loadedMirror();
      return [...mirror.values()];
    },

    async readText(filePath) {
      const slug = slugOfPath(filePath);
      const text = mirror.get(slug)?.filePath === filePath ? texts.get(slug) : undefined;
      if (text === undefined) throw new Error(`no task at ${filePath}`);
      return text;
    },

    write(input) {
      return serialized(async () => {
        await ready();
        const at = now().toISOString();
        const plan = planOf(input);
        const key = parseTaskFile(input.content, input.status, input.slug).task.key ?? null;
        const created = plan.kind === "rename" ? (mirror.get(plan.from)?.createdAt ?? at) : plan.kind === "create" ? (input.times?.createdAt ?? at) : at;
        const updated = plan.kind === "create" ? (input.times?.updatedAt ?? at) : at;
        const row: NewRow = { slug: input.slug, key, status: input.status, placement: input.placement, content: input.content, createdAt: created, updatedAt: updated };
        const expected = input.revision ?? knownRevision(plan);
        const transactionPlan =
          plan.kind === "create"
            ? transaction(names, [tombstonePurge(names, row.slug), insertStep(names, row, false)], [row.slug])
            : plan.kind === "update"
              ? transaction(names, [updateStep(names, row, expected)], [row.slug])
              : transaction(names, [tombstonePurge(names, row.slug), tombstoneStep(names, plan.from, expected, at), insertStep(names, row, true)], [row.slug, plan.from]);
        const rows = await commit(transactionPlan);
        const written = rows.find((candidate) => candidate.slug === input.slug);
        return {
          filePath: taskFilePath(url, { status: input.status, slug: input.slug, assignee: input.placement.assignee, epic: epicOf(input.placement) }),
          revision: written?.version ?? null,
        };
      });
    },

    remove(filePath, revision) {
      return serialized(async () => {
        await ready();
        const slug = slugOfPath(filePath);
        const known = revision ?? mirror.get(slug)?.revision ?? undefined;
        await commit(transaction(names, [tombstoneStep(names, slug, known, now().toISOString())], [slug]));
      });
    },

    sync,

    state: () => link.state,

    async readBoard() {
      await loadedMirror();
      return board.name === "" && board.prefix === "" ? null : board;
    },

    writeBoard(row) {
      return serialized(async () => {
        await ready();
        unwrap(await client.execute(`UPDATE ${names.head} SET name = ?, prefix = ?, seq = seq + 1 WHERE id = 1`, [row.name, row.prefix]));
        board = { name: row.name, prefix: row.prefix };
      });
    },

    writePrefix(prefix) {
      return serialized(async () => {
        await ready();
        unwrap(await client.execute(`UPDATE ${names.head} SET prefix = ?, seq = seq + 1 WHERE id = 1`, [prefix]));
        board = { ...board, prefix };
      });
    },

    tables: () => tables,

    addTable(id, name, parent) {
      return serialized(async () => {
        await ready();
        const added: DbTable = { id, name, parent, fields: [] };
        // The row and the counter's move land together or not at all: a table no poll is told of would never show elsewhere.
        const steps = unwrap(
          await client.batch([
            { sql: "BEGIN IMMEDIATE" },
            { sql: "INSERT INTO tables (id, name, parent, created_at) VALUES (?, ?, ?, ?)", args: [id, name, parent, now().toISOString()], condition: { type: "ok", step: 0 } },
            { sql: `UPDATE ${names.head} SET seq = seq + 1 WHERE id = 1`, condition: { type: "ok", step: 1 } },
            { sql: "COMMIT", condition: { type: "ok", step: 2 } },
            { sql: "ROLLBACK", condition: { type: "not", cond: { type: "ok", step: 3 } } },
          ]),
        );
        const failed = steps.slice(0, 4).find((step) => step.kind === "error");
        if (failed?.kind === "error") throw new Error(`database error ${failed.code}: ${failed.message}`);
        tables = [...tables, added];
        return added;
      });
    },

    addTableField(id, field) {
      return serialized(async () => {
        await ready();
        // Appended inside the database, with the counter's move: a field no poll is told of would never show elsewhere.
        const steps = unwrap(
          await client.batch([
            { sql: "BEGIN IMMEDIATE" },
            { sql: APPEND_TABLE_FIELD, args: [JSON.stringify(field), id], condition: { type: "ok", step: 0 } },
            { sql: `UPDATE ${names.head} SET seq = seq + 1 WHERE id = 1`, condition: { type: "ok", step: 1 } },
            { sql: "COMMIT", condition: { type: "ok", step: 2 } },
            { sql: "ROLLBACK", condition: { type: "not", cond: { type: "ok", step: 3 } } },
          ]),
        );
        const failed = steps.slice(0, 4).find((step) => step.kind === "error");
        if (failed?.kind === "error") throw new Error(`database error ${failed.code}: ${failed.message}`);
        const appended = steps[1];
        if (appended?.kind === "ok" && appended.affectedRowCount === 0) throw new Error(`the section ${id} is not in its database`);
        tables = tables.map((table) => (table.id === id ? { ...table, fields: [...table.fields, field] } : table));
      });
    },

    changeFieldOption(id, field, option, change) {
      return changeTables([{ sql: change === "add" ? ADD_FIELD_OPTION : REMOVE_FIELD_OPTION, args: [id, field, option] }]);
    },

    setFieldIcon(id, field, option, icon) {
      return changeTables([option === null ? { sql: SET_FIELD_ICON, args: [id, field, icon] } : { sql: SET_OPTION_ICON, args: [id, field, option, icon] }]);
    },

    renameTable(id, name) {
      return changeTables([{ sql: RENAME_TABLE, args: [name, id] }]);
    },

    deleteTable(id) {
      return changeTables(subtreeOf(tables, id).flatMap(deleteTableSteps));
    },

    count: () => mirror.size,

    snapshot: () => texts,

    loaded: () => loaded,

    start() {
      if (timer !== null) return;
      timer = setInterval(() => {
        if (polling) return;
        polling = true;
        void sync()
          .catch((error: unknown) => {
            // Lost network, a refused token or no token are the link's business; anything else is a broken database.
            if (!outOfReach(error)) console.warn("tasks-plus: polling the board database failed", error);
          })
          .finally(() => {
            polling = false;
          });
      }, pollMs);
      timer.unref?.();
    },

    stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    },
  };
  return repo;
}
