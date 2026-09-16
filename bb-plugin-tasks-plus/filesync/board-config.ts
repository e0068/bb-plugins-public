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
  folderId: string | null;
  linkedBbProjectId: string | null;
  tasksFolder: string | null;
  createdAt: string;
}

export interface KvStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

const BOARDS_KEY = "boards";

export async function readBoardConfigs(kv: KvStore): Promise<BoardConfig[]> {
  return (await kv.get<BoardConfig[]>(BOARDS_KEY)) ?? [];
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
