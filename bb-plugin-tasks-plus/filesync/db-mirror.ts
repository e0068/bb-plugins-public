import type { TaskStatus } from "../db/types.js";
import type { RepoFile, RepoState } from "./task-repo.js";
import { statusFromFolder } from "./map.js";
import { createdFrom } from "./timestamps.js";
import { parseTaskFile } from "./task-file.js";

/**
 * The pure core of a board kept in a database: how a row reads as a task
 * file, how the in-memory mirror catches up with changed rows, and how the
 * link to the database moves between live, reconnecting and offline. No
 * network, no clock — the shell in db-repo.ts feeds it.
 */

/** A row of the `tasks` table, as the database gives it. */
export interface TaskRow {
  slug: string;
  key: string | null;
  status: string;
  assignee: string | null;
  epic: string | null;
  content: string;
  version: number;
  seq: number;
  deleted: number;
  created_at: string;
  updated_at: string;
}

/** The virtual path of a task: `<address>/[<assignee>/[<epic>/]]<status>/<slug>.md`,
 *  the layout `rootOfTaskFile` turns back into the address. */
export function taskFilePath(
  url: string,
  where: { status: TaskStatus; slug: string; assignee: string | null; epic: string | null },
): string {
  const placement = where.assignee === null ? [] : where.epic === null ? [where.assignee] : [where.assignee, where.epic];
  return [url.replace(/\/+$/, ""), ...placement, where.status, `${where.slug}.md`].join("/");
}

/** The row as a task file of the same format the folder holds; null for a row whose status the board does not know. */
export function rowToRepoFile(url: string, row: TaskRow): RepoFile | null {
  const status = statusFromFolder(row.status);
  if (status === null) return null;
  const parsed = parseTaskFile(row.content, status, row.slug);
  return {
    ...parsed,
    assignee: row.assignee,
    epic: row.epic,
    filePath: taskFilePath(url, { status, slug: row.slug, assignee: row.assignee, epic: row.epic }),
    status,
    slug: row.slug,
    // A board moved into the database got rows dated by the move; the text keeps when each task was made.
    createdAt: createdFrom(parsed.frontmatter.created, row.created_at, Date.parse(row.updated_at)),
    updatedAt: row.updated_at,
    revision: row.version,
  };
}

/** The files of a board by slug. */
export type Mirror = ReadonlyMap<string, RepoFile>;

/** The mirror after the changed rows are laid over it. Of several rows of one
 *  slug the one with the highest `seq` counts, whatever order they come in;
 *  a deleted row, or one that is not a task, takes the slug out. The mirror
 *  given is not touched. */
export function applyRows(mirror: Mirror, url: string, rows: readonly TaskRow[]): Mirror {
  const latest = new Map<string, TaskRow>();
  for (const row of rows) {
    const known = latest.get(row.slug);
    if (known === undefined || known.seq <= row.seq) latest.set(row.slug, row);
  }
  const next = new Map(mirror);
  for (const row of [...latest.values()].sort((a, b) => a.seq - b.seq)) {
    const file = row.deleted === 0 ? rowToRepoFile(url, row) : null;
    if (file === null) next.delete(row.slug);
    else next.set(row.slug, file);
  }
  return next;
}

export interface LinkState {
  state: RepoState;
  /** Failed attempts in a row. */
  failures: number;
  lastSyncAt: string | null;
}

/** Failures in a row after which the link counts as offline. */
const OFFLINE_AFTER = 3;

export const INITIAL_LINK: LinkState = { state: { kind: "live" }, failures: 0, lastSyncAt: null };

/** The link after the database refused the token: refused from the first such answer on, until a success. */
export function refusedLink(link: LinkState, at: string): LinkState {
  const since = link.state.kind === "refused" ? link.state.since : at;
  return { ...link, failures: 0, state: { kind: "refused", since, lastSyncAt: link.lastSyncAt } };
}

/** The link with no token to send: without one from the first such answer on, until a success. */
export function tokenlessLink(link: LinkState, at: string): LinkState {
  const since = link.state.kind === "no-token" ? link.state.since : at;
  return { ...link, failures: 0, state: { kind: "no-token", since, lastSyncAt: link.lastSyncAt } };
}

/** The link after one attempt: the first failure is reconnecting, the third in
 *  a row is offline, the first success is live again. */
export function nextLink(link: LinkState, event: { ok: boolean; at: string }): LinkState {
  if (event.ok) return { state: { kind: "live" }, failures: 0, lastSyncAt: event.at };
  const failures = link.failures + 1;
  const since = link.state.kind === "live" ? event.at : link.state.since;
  if (failures < OFFLINE_AFTER) return { ...link, failures, state: { kind: "reconnecting", since } };
  const offlineSince = link.state.kind === "offline" ? link.state.since : event.at;
  return { ...link, failures, state: { kind: "offline", since: offlineSince, lastSyncAt: link.lastSyncAt } };
}
