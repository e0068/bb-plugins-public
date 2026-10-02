import type { HranaClient, HranaError, HranaResult, HranaRow, HranaStep, HranaStepResult, HranaValue } from "../remote/hrana.js";
import type { TaskStatus } from "../db/types.js";
import { applyRows, INITIAL_LINK, nextLink, taskFilePath, type LinkState, type Mirror, type TaskRow } from "./db-mirror.js";
import { parseTaskFile } from "./task-file.js";
import type { TaskPlacement } from "./placement.js";
import {
  DatabaseAuthFailed,
  DatabaseUnreachable,
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
  onChange?: () => void;
  onStateChange?: (state: RepoState) => void;
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
  /** Polls the database every `pollMs` until `stop()`. */
  start(): void;
  stop(): void;
}

const DEFAULT_POLL_MS = 2000;
const SCHEMA_VERSION = 1;

const SCHEMA_STEPS: readonly HranaStep[] = [
  {
    sql: `CREATE TABLE IF NOT EXISTS tasks (
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
    sql: `CREATE TABLE IF NOT EXISTS board (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      seq INTEGER NOT NULL,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL,
      schema INTEGER NOT NULL
    )`,
  },
  { sql: "INSERT OR IGNORE INTO board (id, seq, name, prefix, schema) VALUES (1, 0, '', '', ?)", args: [SCHEMA_VERSION] },
];

const TASK_COLUMNS = "slug, key, status, assignee, epic, content, version, seq, deleted, created_at, updated_at";
const NEXT_SEQ = "(SELECT seq FROM board) + 1";

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
  if (/tasks\.slug/.test(error.message) || error.code === "SQLITE_CONSTRAINT_PRIMARYKEY") return "slug";
  if (/tasks\.key/.test(error.message) || error.code === "SQLITE_CONSTRAINT_UNIQUE") return "key";
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
function transaction(body: readonly HranaStep[], slugs: readonly string[]): TransactionPlan {
  const begin: HranaStep = { sql: "BEGIN IMMEDIATE" };
  const chained = body.map((step, index) => ({ ...step, condition: ok(index) }));
  /** BEGIN is step 0, so the last statement of the body sits at step `body.length`. */
  const main = body.length;
  const bump: HranaStep = { sql: "UPDATE board SET seq = seq + 1 WHERE changes() > 0", condition: ok(main) };
  const bumpAt = main + 1;
  const commitStep: HranaStep = { sql: "COMMIT", condition: ok(bumpAt) };
  const commitAt = bumpAt + 1;
  const rollback: HranaStep = { sql: "ROLLBACK", condition: { type: "not", cond: ok(commitAt) } };
  const read: HranaStep = {
    sql: `SELECT ${TASK_COLUMNS} FROM tasks WHERE slug IN (${slugs.map(() => "?").join(", ")})`,
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

const tombstonePurge = (slug: string): HranaStep => ({ sql: "DELETE FROM tasks WHERE slug = ? AND deleted = 1", args: [slug] });

const insertStep = (row: NewRow, onlyIfPreviousChanged: boolean): HranaStep => ({
  sql: onlyIfPreviousChanged
    ? `INSERT INTO tasks (${TASK_COLUMNS}) SELECT ?, ?, ?, ?, ?, ?, 1, ${NEXT_SEQ}, 0, ?, ? WHERE changes() > 0`
    : `INSERT INTO tasks (${TASK_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, 1, ${NEXT_SEQ}, 0, ?, ?)`,
  args: rowValues(row),
});

const updateStep = (row: NewRow, expected: number | undefined): HranaStep => {
  const guard = versionGuard(expected);
  return {
    sql: `UPDATE tasks SET key = ?, status = ?, assignee = ?, epic = ?, content = ?, version = version + 1, seq = ${NEXT_SEQ}, updated_at = ? WHERE slug = ? AND deleted = 0${guard.sql}`,
    args: [row.key, row.status, row.placement.assignee, epicOf(row.placement), row.content, row.updatedAt, row.slug, ...guard.args],
  };
};

/** Marks a row deleted and frees its key, in the same stroke as whatever replaces it. */
const tombstoneStep = (slug: string, expected: number | undefined, updatedAt: string): HranaStep => {
  const guard = versionGuard(expected);
  return {
    sql: `UPDATE tasks SET deleted = 1, key = NULL, version = version + 1, seq = ${NEXT_SEQ}, updated_at = ? WHERE slug = ? AND deleted = 0${guard.sql}`,
    args: [updatedAt, slug, ...guard.args],
  };
};

/** Only a network that does not answer moves the link: a refused token or a refused statement is the database answering. */
const linkFailed = (error: HranaError): boolean => error.kind === "unreachable";

export function failureOf(error: HranaError): Error {
  switch (error.kind) {
    case "unreachable":
      return new DatabaseUnreachable();
    case "auth":
      return new DatabaseAuthFailed();
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
  const url = options.url;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const now = options.now ?? (() => new Date());

  let mirror: Mirror = new Map();
  let texts: ReadonlyMap<string, string> = new Map();
  let board: BoardRow = { name: "", prefix: "" };
  let lastSeq = -1;
  let loaded = false;
  let schemaReady = false;
  let link: LinkState = INITIAL_LINK;
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
    const next = nextLink(link, { ok: succeeded, at: now().toISOString() });
    const moved = !sameState(link.state, next.state);
    link = next;
    if (moved) options.onStateChange?.(next.state);
  }

  /** The value, or the failure as the error the port promises; a lost link is counted. */
  function unwrap<T>(result: HranaResult<T>): T {
    if (result.ok) return result.value;
    if (linkFailed(result.error)) touch(false);
    throw failureOf(result.error);
  }

  async function ensureSchema(): Promise<void> {
    if (schemaReady) return;
    const steps = unwrap(await client.batch(SCHEMA_STEPS));
    const failed = steps.find((step) => step.kind === "error");
    if (failed?.kind === "error") throw new Error(`database error ${failed.code}: ${failed.message}`);
    schemaReady = true;
  }

  async function pull(): Promise<void> {
    await ensureSchema();
    const head = decodeBoardHead(unwrap(await client.execute("SELECT seq, name, prefix FROM board WHERE id = 1")).rows);
    const { rows: changed, unreadable } =
      head.seq > lastSeq
        ? decodeTaskRows(unwrap(await client.execute(`SELECT ${TASK_COLUMNS} FROM tasks WHERE seq > ? ORDER BY seq`, [lastSeq])).rows)
        : NO_ROWS;
    reportUnreadable(unreadable);
    const nextMirror = applyRows(mirror, url, changed);
    texts = applyTexts(texts, changed);
    const somethingNew = mirrorChanged(mirror, nextMirror) || head.name !== board.name || head.prefix !== board.prefix;
    mirror = nextMirror;
    board = { name: head.name, prefix: head.prefix };
    lastSeq = changed.reduce((latest, row) => Math.max(latest, row.seq), Math.max(lastSeq, head.seq));
    loaded = true;
    touch(true);
    if (somethingNew) options.onChange?.();
  }

  /** A write needs a link that is not known to be down, and a mirror to write against. */
  async function ready(): Promise<void> {
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
            ? transaction([tombstonePurge(row.slug), insertStep(row, false)], [row.slug])
            : plan.kind === "update"
              ? transaction([updateStep(row, expected)], [row.slug])
              : transaction([tombstonePurge(row.slug), tombstoneStep(plan.from, expected, at), insertStep(row, true)], [row.slug, plan.from]);
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
        await commit(transaction([tombstoneStep(slug, known, now().toISOString())], [slug]));
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
        unwrap(await client.execute("UPDATE board SET name = ?, prefix = ?, seq = seq + 1 WHERE id = 1", [row.name, row.prefix]));
        board = { name: row.name, prefix: row.prefix };
      });
    },

    writePrefix(prefix) {
      return serialized(async () => {
        await ready();
        unwrap(await client.execute("UPDATE board SET prefix = ?, seq = seq + 1 WHERE id = 1", [prefix]));
        board = { ...board, prefix };
      });
    },

    count: () => mirror.size,

    start() {
      if (timer !== null) return;
      timer = setInterval(() => {
        if (polling) return;
        polling = true;
        void sync()
          .catch((error: unknown) => {
            // Lost network and a refused token are the link's business; anything else is a broken database.
            if (!(error instanceof DatabaseUnreachable) && !(error instanceof DatabaseAuthFailed)) console.warn("tasks-plus: polling the board database failed", error);
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
