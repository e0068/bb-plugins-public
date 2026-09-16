import { join } from "node:path";
import type { BoardRoot } from "./fs-boards.js";

/**
 * Окружение треда, из которого пришёл вызов, — одно и уже разрешённое
 * оболочкой по известному id (filesync/resolve-roots.ts). Списка живых
 * деревьев здесь нет: именно обход всех деревьев на каждое чтение вешал RPC
 * (decisions/tasks-plus-board-roots-blocks-rpc.md).
 */
export interface CallerEnvironment {
  environmentId: string;
  /** bb-проект окружения: своё дерево получает только доска этого проекта. */
  projectId: string;
  /** Путь дерева на диске; null, когда окружение его не имеет. */
  path: string | null;
  name: string | null;
  branchName: string | null;
  /** false — тред работает в главном чекауте, отдельного дерева у него нет. */
  isWorktree: boolean;
  /** Машина окружения: файлы вызывающего лежат на ней, не на сервере. */
  hostId: string;
}

/** Доска в той мере, в какой она влияет на выбор корня. */
export interface RootedBoard {
  linkedBbProjectId: string | null;
  tasksFolder: string | null;
}

/**
 * Корень доски в дереве вызвавшего треда — или null, когда его нет: тред без
 * окружения, тред в главном чекауте, доска чужого проекта, доска без
 * подключённой папки. Null означает «работаем с main», и это же правило
 * оставляет интерфейс доски (у которого треда нет) на главном чекауте.
 */
export function callerWorktreeRoot(
  board: RootedBoard,
  caller: CallerEnvironment | null,
): BoardRoot | null {
  if (!caller || !caller.isWorktree || caller.path === null) return null;
  if (board.tasksFolder === null || board.linkedBbProjectId === null) return null;
  if (board.linkedBbProjectId !== caller.projectId) return null;
  return {
    absPath: join(caller.path, board.tasksFolder),
    origin: {
      kind: "worktree",
      environmentId: caller.environmentId,
      name: caller.name,
      branchName: caller.branchName,
    },
  };
}

/**
 * Папка, которую читает один запрос, — ровно одна: дерево спрашивающего
 * треда, а если своего дерева у него нет — main доски. Мир запроса из ветки
 * ограничен её деревом: иначе задача, лежащая и там, и в main, читалась бы
 * и правилась бы в главном чекауте, и агент, работающий в ветке, писал бы
 * в общую копию (BBPL-301, решение владельца от 2026-09-12).
 *
 * Отсюда же следует, что и запись остаётся в ветке: корень правки берётся
 * из пути найденного файла (`rootOfTask` в filesync/store.ts), а найден он
 * будет там, где искали.
 */
export function requestRoots(
  mainRoots: readonly BoardRoot[],
  callerRoot: BoardRoot | null,
): BoardRoot[] {
  return callerRoot ? [callerRoot] : [...mainRoots];
}
