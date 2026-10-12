import type { BoardConfig } from "../filesync/board-config.js";

/** A bb project as the Projects tab needs it: what identifies it and where its repository is. */
export type RowBbProject = { id: string; name: string; repoPath: string | null };

export type ProjectRows = {
  /** One row per bb project, in bb's order; the board that took the project, or none. */
  projects: { bbProject: RowBbProject; board: BoardConfig | null }[];
  /** The boards no row holds, by name. */
  orphans: BoardConfig[];
  /** The boards in a row whose name drifted from their bb project's. */
  renames: { boardId: string; name: string }[];
};

/**
 * Whether the board keeps its tasks somewhere — a folder or a database. A board
 * with neither has nothing to show in a row, so it does not hold its bb project.
 */
export const holdsProject = (board: BoardConfig): boolean => board.tasksFolder !== null || board.database !== null;

const byName = (a: BoardConfig, b: BoardConfig): number => a.name.localeCompare(b.name);

/**
 * Lays the boards out against bb's projects: every bb project is exactly one
 * row, every board is in exactly one table. Only a board that holds its
 * project (has a folder or a database) takes the row; of several boards linked
 * to one bb project (written before one-board-per-project) the first of those
 * in the list keeps it, and the rest — and any board with no source — are orphans.
 */
export function projectRows(bbProjects: readonly RowBbProject[], boards: readonly BoardConfig[]): ProjectRows {
  const listed = new Set(bbProjects.map((bbProject) => bbProject.id));
  // Reversed, so that of two boards on one project the earlier one is written last and wins.
  const holders = new Map(
    boards
      .filter((board) => holdsProject(board) && board.linkedBbProjectId !== null && listed.has(board.linkedBbProjectId))
      .reverse()
      .map((board) => [board.linkedBbProjectId, board] as const),
  );
  const projects = bbProjects.map((bbProject) => ({ bbProject, board: holders.get(bbProject.id) ?? null }));
  const placed = new Set(projects.flatMap(({ board }) => (board === null ? [] : [board.id])));
  return {
    projects,
    orphans: boards.filter((board) => !placed.has(board.id)).sort(byName),
    renames: projects.flatMap(({ bbProject, board }) =>
      board !== null && board.name !== bbProject.name ? [{ boardId: board.id, name: bbProject.name }] : [],
    ),
  };
}
