import { readFile, rm } from "node:fs/promises";
import type { TaskStatus } from "../db/types.js";
import { readTaskFiles, writeTaskFile, type RepoTaskFile } from "./fs-repo.js";
import { createParseCache, type ParseCache } from "./parse-cache.js";
import type { TaskPlacement } from "./placement.js";

/**
 * The tree of a board's task files, as the store sees it. Two kinds hold it:
 * a folder (`diskRepo`, the plain functions of fs-repo.ts) and a database
 * (filesync/db-repo.ts). Parsing, assembling and rendering stay one for
 * both; only where the files live differs.
 */

/** A file of the tree with the version of the row it came from — `null` for a
 *  folder, which keeps no versions. */
export type RepoFile = RepoTaskFile & { revision: number | null };

export interface RepoWrite {
  status: TaskStatus;
  slug: string;
  placement: TaskPlacement;
  content: string;
  /** Where the task lived before, when this write moves or renames it. */
  previousPath?: string;
  /** The version the caller read; a repository that keeps versions refuses the write when the row has moved on. */
  revision?: number;
  /** When a new task was created and last changed, for a copy that keeps the task's history; absent — now. */
  times?: { createdAt: string; updatedAt: string };
}

export type RepoState =
  | { kind: "live" }
  | { kind: "reconnecting"; since: string }
  | { kind: "offline"; since: string; lastSyncAt: string | null };

export interface TaskRepo {
  list(): Promise<RepoFile[]>;
  readText(filePath: string): Promise<string>;
  write(input: RepoWrite): Promise<{ filePath: string; revision: number | null }>;
  remove(filePath: string, revision?: number): Promise<void>;
  /** Catches up with what other machines wrote. */
  sync(): Promise<void>;
  state(): RepoState;
}

/** A conditional write that lost: the row moved on (`version`), or the key or the slug is already taken. */
export class WriteConflict extends Error {
  constructor(readonly reason: "version" | "key" | "slug") {
    super(`write conflict: ${reason}`);
    this.name = "WriteConflict";
  }
}

/** The database cannot be reached, and nothing is known to show in its place. */
export class DatabaseUnreachable extends Error {
  constructor() {
    super("the database cannot be reached");
    this.name = "DatabaseUnreachable";
  }
}

/** The database refused the board's token. */
export class DatabaseAuthFailed extends Error {
  constructor() {
    super("the database refused the token");
    this.name = "DatabaseAuthFailed";
  }
}

const LIVE: RepoState = { kind: "live" };

/** A folder of task files: fresh on every read, no versions, always live. */
export function diskRepo(root: string, cache: ParseCache = createParseCache()): TaskRepo {
  return {
    async list() {
      const files = await readTaskFiles(root, cache);
      return files.map((file) => ({ ...file, revision: null }));
    },
    readText: (filePath) => readFile(filePath, "utf8"),
    async write({ status, slug, placement, content, previousPath }) {
      const filePath = await writeTaskFile(root, status, slug, content, previousPath, placement);
      return { filePath, revision: null };
    },
    remove: (filePath) => rm(filePath, { force: true }),
    sync: () => Promise.resolve(),
    state: () => LIVE,
  };
}
