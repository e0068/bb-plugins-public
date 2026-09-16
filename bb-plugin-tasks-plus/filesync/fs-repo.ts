import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { TaskStatus } from "../db/types.js";
import { statusFromFolder } from "./map.js";
import { parseTaskFile, type ParsedTaskFile } from "./task-file.js";
import { taskTimestamps } from "./timestamps.js";
import { NO_PLACEMENT, placementSegments, type TaskPlacement } from "./placement.js";

/** Plain node:fs/promises reads and writes — no watcher, no cache, no
 * background sync. A board's files are read fresh on every request; using
 * the async fs API rather than the *Sync one keeps that request from
 * blocking the plugin's single event loop while it waits on disk (see
 * decisions/tasks-plus-board-roots-blocks-rpc.md). */
export interface RepoTaskFile extends ParsedTaskFile, TaskPlacement {
  filePath: string;
  status: TaskStatus;
  slug: string;
  /** When the file was created and last changed, from the filesystem — the
   *  only place that knows (see filesync/timestamps.ts). */
  createdAt: string;
  updatedAt: string;
}

/** Reads every `<absRoot>/[<assignee>/[<epic>/]]<status>/<slug>.md`. A
 *  folder whose name is a status holds tasks; any other visible folder is an
 *  assignee at the first level and an epic at the second, and nothing deeper
 *  is looked at. A missing folder is skipped; a file is skipped only when
 *  the disk will not hand it over — content it cannot make sense of still
 *  comes back as a task with empty fields (see
 *  decisions/tasks-every-file-in-a-status-folder-is-a-task.md). */
export async function readTaskFiles(absRoot: string): Promise<RepoTaskFile[]> {
  return (await readLevel(absRoot, NO_PLACEMENT)).flat();
}

async function readLevel(dir: string, placement: TaskPlacement): Promise<RepoTaskFile[][]> {
  const entries = await safeReaddir(dir);
  const perEntry = await Promise.all(
    entries.map(async (entry): Promise<RepoTaskFile[][]> => {
      const status = statusFromFolder(entry);
      if (status !== null) return [await readStatusDir(join(dir, entry), status, placement)];
      if (entry.startsWith(".") || placement.epic !== null) return [];
      const child: TaskPlacement =
        placement.assignee === null ? { assignee: entry, epic: null } : { ...placement, epic: entry };
      return readLevel(join(dir, entry), child);
    }),
  );
  return perEntry.flat();
}

async function readStatusDir(
  statusDir: string,
  status: TaskStatus,
  placement: TaskPlacement,
): Promise<RepoTaskFile[]> {
  const names = (await safeReaddir(statusDir)).filter((name) => name.endsWith(".md"));
  const results = await Promise.all(names.map((name) => readOneTaskFile(statusDir, status, name, placement)));
  return results.filter((file): file is RepoTaskFile => file !== null);
}

async function readOneTaskFile(
  statusDir: string,
  status: TaskStatus,
  name: string,
  placement: TaskPlacement,
): Promise<RepoTaskFile | null> {
  const slug = name.slice(0, -".md".length);
  const filePath = join(statusDir, name);
  let content: string;
  let times: { birthtimeMs: number; mtimeMs: number };
  try {
    const [read, stats] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
    content = read;
    times = { birthtimeMs: stats.birthtimeMs, mtimeMs: stats.mtimeMs };
  } catch {
    return null;
  }
  const parsed = parseTaskFile(content, status, slug);
  return { ...parsed, ...taskTimestamps(times), ...placement, filePath, status, slug };
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/** Writes (moving first, when the status or the placement changed) and
 *  returns the new path. A status folder already spelled another way in the
 *  target folder ("In progress") is written into rather than doubled by a
 *  canonical `in_progress/` beside it. */
export async function writeTaskFile(
  absRoot: string,
  status: TaskStatus,
  slug: string,
  content: string,
  previousPath?: string,
  placement: TaskPlacement = NO_PLACEMENT,
): Promise<string> {
  const parent = join(absRoot, ...placementSegments(placement));
  const statusDir = join(parent, await statusFolderName(parent, status, previousPath));
  const newPath = join(statusDir, `${slug}.md`);
  await mkdir(statusDir, { recursive: true });
  if (previousPath && previousPath !== newPath) {
    // rename() replaces silently, and the file already there is a task too —
    // one that onePerSlug hid behind this one's slug.
    if (await exists(newPath)) throw new Error(`cannot move the task: ${newPath} already exists`);
    await rename(previousPath, newPath);
  }
  await writeFile(newPath, content, "utf8");
  return newPath;
}

/** The status folder to write into: the file's own when it already sits in
 *  one for this status under `parent` — two spellings side by side must not
 *  swap the file between them on an edit — else any existing spelling, else
 *  the canonical name. */
async function statusFolderName(parent: string, status: TaskStatus, previousPath?: string): Promise<string> {
  if (previousPath && dirname(dirname(previousPath)) === parent) {
    const own = basename(dirname(previousPath));
    if (statusFromFolder(own) === status) return own;
  }
  return (await safeReaddir(parent)).find((entry) => statusFromFolder(entry) === status) ?? status;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Корень, в котором лежит файл задачи, — обратная сторона раскладки
 *  `<корень>/[<исполнитель>/[<эпик>/]]<статус>/<слаг>.md`. Живёт рядом с
 *  самой раскладкой, чтобы обе её половины менялись вместе. */
export function rootOfTaskFile(filePath: string, placement: TaskPlacement = NO_PLACEMENT): string {
  const statusDir = dirname(filePath);
  return placementSegments(placement).reduce((dir) => dirname(dir), dirname(statusDir));
}
