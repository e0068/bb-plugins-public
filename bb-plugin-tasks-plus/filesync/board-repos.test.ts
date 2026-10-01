import { describe, expect, it } from "vitest";
import { planned } from "../test-support/planned.js";
import type { BoardConfig } from "./board-config.js";

const reposPath = "./board-repos.js";
const repoPath = "./task-repo.js";
const { createBoardRepos } = await planned<typeof import("./board-repos.js")>(() => import(/* @vite-ignore */ reposPath));
const { DatabaseUnreachable } = await planned<typeof import("./task-repo.js")>(() => import(/* @vite-ignore */ repoPath));

type TaskRepo = import("./task-repo.js").TaskRepo;

const folderBoard: BoardConfig = {
  id: "b1",
  name: "Board",
  prefix: "TSK",
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  tasksFolder: "docs/tasks",
  database: null, createdAt: "2026-01-01T00:00:00.000Z",
};
const databaseBoard: BoardConfig = { ...folderBoard, id: "b2", tasksFolder: null, database: { url: "libsql://board-me.turso.io" } };

const fakeRepo = { state: () => ({ kind: "live" }) } as unknown as TaskRepo;

describe("which repository a board reads", () => {
  it("a folder board has none of its own: it reads its folders", () => {
    expect(createBoardRepos().repoFor(folderBoard)).toBeNull();
  });

  it("a database board reads the repository set for it", () => {
    const repos = createBoardRepos();
    repos.set(databaseBoard.id, fakeRepo);
    expect(repos.repoFor(databaseBoard)).toBe(fakeRepo);
  });

  it("a database board with no repository yet is unreachable, never an empty board", () => {
    const repos = createBoardRepos();
    expect(() => repos.repoFor(databaseBoard)).toThrow(DatabaseUnreachable);
    repos.set(databaseBoard.id, fakeRepo);
    repos.remove(databaseBoard.id);
    expect(() => repos.repoFor(databaseBoard)).toThrow(DatabaseUnreachable);
  });
});
