import type { BoardConfig } from "./board-config.js";
import { DatabaseUnreachable, type TaskRepo } from "./task-repo.js";

/** The repositories of the boards that live in a database, by board id. */
export interface BoardRepos {
  set(boardId: string, repo: TaskRepo): void;
  remove(boardId: string): void;
  /** `null` for a folder board (it reads its folders); the set repository for
   *  a database board; `DatabaseUnreachable` while a database board has none —
   *  never an empty board. */
  repoFor(board: BoardConfig): TaskRepo | null;
}

export function createBoardRepos(): BoardRepos {
  const repos = new Map<string, TaskRepo>();
  return {
    set: (boardId, repo) => void repos.set(boardId, repo),
    remove: (boardId) => void repos.delete(boardId),
    repoFor(board) {
      if (!board.database) return null;
      const repo = repos.get(board.id);
      if (repo === undefined) throw new DatabaseUnreachable();
      return repo;
    },
  };
}
