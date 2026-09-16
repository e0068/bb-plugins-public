import { describe, expect, it } from "vitest";
import { callerWorktreeRoot, requestRoots, type CallerEnvironment } from "./caller-root.js";
import type { BoardRoot } from "./fs-boards.js";

const board = { linkedBbProjectId: "proj_x", tasksFolder: "memory/tasks" };
const main: BoardRoot = { absPath: "/repo/main/memory/tasks", origin: { kind: "main" } };

function caller(overrides: Partial<CallerEnvironment> = {}): CallerEnvironment {
  return {
    environmentId: "env_1",
    projectId: "proj_x",
    path: "/worktrees/env_1",
    name: "agent-x",
    branchName: "bb/thr_1",
    isWorktree: true,
    hostId: "host_1",
    ...overrides,
  };
}

describe("callerWorktreeRoot", () => {
  it("отдаёт дерево вызвавшего треда как корень доски того же проекта", () => {
    expect(callerWorktreeRoot(board, caller())).toEqual({
      absPath: "/worktrees/env_1/memory/tasks",
      origin: {
        kind: "worktree",
        environmentId: "env_1",
        name: "agent-x",
        branchName: "bb/thr_1",
      },
    });
  });

  it("ничего не отдаёт без вызывающего окружения", () => {
    expect(callerWorktreeRoot(board, null)).toBeNull();
  });

  it("ничего не отдаёт треду в главном чекауте — его задачи пишутся в main", () => {
    expect(callerWorktreeRoot(board, caller({ isWorktree: false }))).toBeNull();
  });

  it("ничего не отдаёт доске чужого bb-проекта", () => {
    expect(callerWorktreeRoot(board, caller({ projectId: "proj_other" }))).toBeNull();
  });

  it("ничего не отдаёт доске без подключённой папки или проекта", () => {
    expect(callerWorktreeRoot({ ...board, tasksFolder: null }, caller())).toBeNull();
    expect(callerWorktreeRoot({ ...board, linkedBbProjectId: null }, caller())).toBeNull();
  });

  it("ничего не отдаёт окружению без пути на диске", () => {
    expect(callerWorktreeRoot(board, caller({ path: null }))).toBeNull();
  });
});

describe("requestRoots", () => {
  const worktree: BoardRoot = {
    absPath: "/worktrees/env_1/memory/tasks",
    origin: { kind: "worktree", environmentId: "env_1", name: "agent-x", branchName: "bb/thr_1" },
  };

  it("дерево треда вытесняет main — запрос из ветки видит только её", () => {
    expect(requestRoots([main], worktree)).toEqual([worktree]);
  });

  it("без своего дерева остаётся один main", () => {
    expect(requestRoots([main], null)).toEqual([main]);
  });

  it("не читает одну папку дважды, когда дерево треда и есть main", () => {
    expect(requestRoots([main], { ...worktree, absPath: main.absPath })).toEqual([
      { ...worktree, absPath: main.absPath },
    ]);
  });

  it("отдаёт своё дерево и тогда, когда main доски ещё не разрешён", () => {
    expect(requestRoots([], worktree)).toEqual([worktree]);
  });
});
