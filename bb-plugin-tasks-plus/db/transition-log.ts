// Append-only log of task status transitions, on the plugin's better-sqlite3
// database (see decisions/tasks-plus-transition-log-sqlite.md). The task store
// itself is md files (BBPL-183) and carries only the current status; this table
// is the chronological series analytics needs — one row per status change,
// queried by date range.
//
// A thin store over a structural slice of the db handle (like db-view's
// ConnectionDb), so it neither imports better-sqlite3's types nor the task
// status enum — the log is neutral about the status vocabulary it records.

/** The slice of bb.storage.database() this store uses. */
export interface TransitionDb {
  exec(sql: string): unknown;
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
  };
}

/** One recorded status change. `fromStatus`/`actor` are null when unknown (a task's first appearance, or a change with no named author). */
export interface StatusTransition {
  taskId: string;
  projectId: string;
  fromStatus: string | null;
  toStatus: string;
  /** Epoch ms the change happened — supplied by the caller (the shell owns the clock). */
  atMs: number;
  actor: string | null;
}

/** Narrowing of a range query. */
export interface TransitionFilter {
  projectId?: string;
}

/** Records transitions and reads them back by date range. */
export interface TransitionLog {
  record(transition: StatusTransition): void;
  /** Transitions whose `atMs` lies in `[fromMs, toMs)`, oldest first, optionally one project only. */
  range(fromMs: number, toMs: number, filter?: TransitionFilter): StatusTransition[];
}

const SCHEMA = `
  create table if not exists status_transitions (
    id integer primary key autoincrement,
    task_id text not null,
    project_id text not null,
    from_status text,
    to_status text not null,
    at_ms integer not null,
    actor text
  );
  create index if not exists idx_status_transitions_at on status_transitions (at_ms);
  create index if not exists idx_status_transitions_project_at on status_transitions (project_id, at_ms);
`;

interface Row {
  task_id: string;
  project_id: string;
  from_status: string | null;
  to_status: string;
  at_ms: number;
  actor: string | null;
}

function toTransition(row: Row): StatusTransition {
  return {
    taskId: row.task_id,
    projectId: row.project_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    atMs: row.at_ms,
    actor: row.actor,
  };
}

export function createTransitionLog(db: TransitionDb): TransitionLog {
  db.exec(SCHEMA);
  const insert = db.prepare(
    "insert into status_transitions (task_id, project_id, from_status, to_status, at_ms, actor) values (?, ?, ?, ?, ?, ?)",
  );
  // Two prepared reads rather than one with an optional predicate: SQLite binds
  // by position, and a single "project_id = ? or ? is null" form would make the
  // planner ignore the index. The branch here is on the query shape, not data.
  const selectAll = db.prepare(
    "select task_id, project_id, from_status, to_status, at_ms, actor from status_transitions where at_ms >= ? and at_ms < ? order by at_ms, id",
  );
  const selectByProject = db.prepare(
    "select task_id, project_id, from_status, to_status, at_ms, actor from status_transitions where at_ms >= ? and at_ms < ? and project_id = ? order by at_ms, id",
  );

  return {
    record(transition) {
      insert.run(
        transition.taskId,
        transition.projectId,
        transition.fromStatus,
        transition.toStatus,
        transition.atMs,
        transition.actor,
      );
    },
    range(fromMs, toMs, filter) {
      const rows =
        filter?.projectId === undefined
          ? (selectAll.all(fromMs, toMs) as Row[])
          : (selectByProject.all(fromMs, toMs, filter.projectId) as Row[]);
      return rows.map(toTransition);
    },
  };
}
