import type { RepoState } from "../filesync/task-repo.js";
import type { SyncedSource } from "./contract.js";

/**
 * What "Connect database" decides, as pure functions: which token opens the
 * database, what connecting does with the database it opened, and how a
 * board's link reads as a source row. No network, no settings, no clock.
 */

export type TokenSource = { kind: "given"; token: string } | { kind: "mint" };

/** The token without its padding; nothing when blank. */
export const usableToken = (token: string | null | undefined): string | null => {
  const trimmed = token?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

/** The token typed, else the one in the address, else the one saved for the address; with none, Turso is asked for one. */
export function tokenSource(input: { token?: string | null }, address: { token: string | null }, saved: string | null): TokenSource {
  const token = usableToken(input.token) ?? usableToken(address.token) ?? usableToken(saved);
  return token === null ? { kind: "mint" } : { kind: "given", token };
}

export type ConnectPlan =
  | { kind: "copy"; sourceId: string; name: string; prefix: string }
  | { kind: "adopt"; name: string; prefix: string }
  | { kind: "fresh"; name: string; prefix: string }
  | { kind: "refuse"; code: "database_not_empty" | "folder_connect_failed"; message: string };

export interface ConnectInput {
  copyFrom: { id: string; name: string; prefix: string } | null;
  name?: string | null;
  prefix?: string | null;
}

/** What the opened database holds: the board it names, and how many tasks. */
export interface DatabaseFacts {
  board: { name: string; prefix: string } | null;
  taskCount: number;
}

const PREFIX_PATTERN = /^[A-Z][A-Z0-9]{0,9}$/;

const refuse = (code: "database_not_empty" | "folder_connect_failed", message: string): ConnectPlan => ({ kind: "refuse", code, message });

/**
 * A folder board is copied only into an empty database, under its own name
 * and prefix; the folder board stays as it is. A database that already holds
 * a board gives the new board its name and prefix. An empty database starts
 * a board with the name and prefix given.
 */
export function planConnect(input: ConnectInput, facts: DatabaseFacts): ConnectPlan {
  const empty = facts.board === null && facts.taskCount === 0;
  if (input.copyFrom !== null) {
    return empty
      ? { kind: "copy", sourceId: input.copyFrom.id, name: input.copyFrom.name, prefix: input.copyFrom.prefix }
      : refuse("database_not_empty", "This database already holds a board. Tasks can only be copied into an empty database.");
  }
  if (facts.board !== null) return { kind: "adopt", name: facts.board.name, prefix: facts.board.prefix };
  const name = (input.name ?? "").trim();
  const prefix = (input.prefix ?? "").trim().toUpperCase();
  if (name === "" || prefix === "") return refuse("folder_connect_failed", "This database is empty: give its board a name and a key prefix.");
  if (!PREFIX_PATTERN.test(prefix)) return refuse("folder_connect_failed", "The key prefix must be 1 to 10 letters or digits, starting with a letter.");
  return { kind: "fresh", name, prefix };
}

/**
 * A database board's link as a row shows it. A live link has just synced.
 * A link that began failing went down right after its last sync, so the
 * moment it started failing stands for it; an offline link knows its own.
 */
export function sourceOf(url: string, state: RepoState, now: string): Extract<SyncedSource, { kind: "database" }> {
  switch (state.kind) {
    case "live":
      return { kind: "database", url, state: "live", lastSyncAt: now };
    case "reconnecting":
      return { kind: "database", url, state: "reconnecting", lastSyncAt: state.since };
    case "offline":
      return { kind: "database", url, state: "offline", lastSyncAt: state.lastSyncAt };
  }
}
