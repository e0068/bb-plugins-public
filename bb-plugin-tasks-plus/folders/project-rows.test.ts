import { describe, expect, it } from "vitest";
import type { BoardConfig } from "../filesync/board-config.js";
import { projectRows, type RowBbProject } from "./project-rows.js";

const bbProject = (id: string, name: string, repoPath: string | null = `/repos/${name}`): RowBbProject => ({ id, name, repoPath });

const board = (id: string, name: string, patch: Partial<BoardConfig> = {}): BoardConfig => ({
  id,
  name,
  prefix: id.toUpperCase(),
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  tasksFolder: "docs/tasks",
  database: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...patch,
});

const PERSONAL = bbProject("proj_personal", "Personal", null);
const PLUGINS = bbProject("proj_plugins", "bb-plugins");
const CELLULAR = bbProject("proj_cellular", "Cellular");

const BBPL = board("bbpl", "bb-plugins", { linkedBbProjectId: "proj_plugins", tasksFolder: null, database: { url: "libsql://bbpl.turso.io" } });
const CEL = board("cel", "Cellular old name", { linkedBbProjectId: "proj_cellular" });
const BP = board("bp", "bb-plugins");
const GONE = board("gone", "Removed project", { linkedBbProjectId: "proj_removed" });
/** Neither a folder nor a database: the Folders tab never showed it. */
const BARE = board("bare", "Bare", { tasksFolder: null });

describe("rows of the Projects tab", () => {
  const rows = projectRows([PLUGINS, PERSONAL, CELLULAR], [CEL, BP, BBPL, GONE, BARE]);

  it("has one row per bb project, in bb's order, the personal project included", () => {
    expect(rows.projects.map((row) => row.bbProject.id)).toEqual(["proj_plugins", "proj_personal", "proj_cellular"]);
  });

  it("puts the board linked to a bb project in that project's row, and nothing in a row without one", () => {
    expect(rows.projects.map((row) => row.board?.id ?? null)).toEqual(["bbpl", null, "cel"]);
  });

  it("lists every board no bb project holds as an orphan, by name", () => {
    expect(rows.orphans.map((orphan) => orphan.id)).toEqual(["bare", "bp", "gone"]);
  });

  it("names the linked boards whose name drifted from their bb project", () => {
    expect(rows.renames).toEqual([{ boardId: "cel", name: "Cellular" }]);
  });

  it("never renames an orphan: it keeps the last name it had", () => {
    expect(rows.renames.map((rename) => rename.boardId)).not.toContain("gone");
  });
});

describe("rows on the edges", () => {
  it("makes every board an orphan when bb lists no project", () => {
    const rows = projectRows([], [BBPL, CEL]);
    expect(rows.projects).toEqual([]);
    expect(rows.orphans.map((orphan) => orphan.id).sort()).toEqual(["bbpl", "cel"]);
    expect(rows.renames).toEqual([]);
  });

  it("keeps the first of two boards linked to one bb project in its row and makes the second an orphan", () => {
    const twin = board("twin", "bb-plugins", { linkedBbProjectId: "proj_plugins" });
    const rows = projectRows([PLUGINS], [BBPL, twin]);
    expect(rows.projects[0]?.board?.id).toBe("bbpl");
    expect(rows.orphans.map((orphan) => orphan.id)).toEqual(["twin"]);
  });

  it("gives an empty board list one empty row per bb project", () => {
    const rows = projectRows([PLUGINS, PERSONAL], []);
    expect(rows.projects).toEqual([
      { bbProject: PLUGINS, board: null },
      { bbProject: PERSONAL, board: null },
    ]);
    expect(rows.orphans).toEqual([]);
  });

  it("places each board in exactly one table and each bb project in exactly one row, whatever the mix", () => {
    const projects = [PLUGINS, PERSONAL, CELLULAR];
    const boards = [CEL, BP, BBPL, GONE, BARE];
    for (let mask = 0; mask < 1 << boards.length; mask++) {
      const picked = boards.filter((_, index) => (mask >> index) & 1);
      const rows = projectRows(projects, picked);
      const placed = [...rows.projects.flatMap((row) => (row.board === null ? [] : [row.board.id])), ...rows.orphans.map((orphan) => orphan.id)];
      expect(placed.sort()).toEqual(picked.map((one) => one.id).sort());
      expect(rows.projects.map((row) => row.bbProject.id)).toEqual(projects.map((project) => project.id));
    }
  });
});

describe("a linked board without a folder or a database", () => {
  const EMPTY = board("empty", "bb-plugins", { linkedBbProjectId: "proj_plugins", tasksFolder: null });
  const REAL = board("real", "bb-plugins", { linkedBbProjectId: "proj_plugins" });

  it("does not hold its project's row, which stays open for Connect, and is an orphan to delete", () => {
    const rows = projectRows([PLUGINS], [EMPTY]);
    expect(rows.projects).toEqual([{ bbProject: PLUGINS, board: null }]);
    expect(rows.orphans.map((orphan) => orphan.id)).toEqual(["empty"]);
  });

  it("leaves the row to the board that has a folder, whichever comes first", () => {
    for (const boards of [[EMPTY, REAL], [REAL, EMPTY]]) {
      const rows = projectRows([PLUGINS], boards);
      expect(rows.projects[0]?.board?.id).toBe("real");
      expect(rows.orphans.map((orphan) => orphan.id)).toEqual(["empty"]);
    }
  });
});
