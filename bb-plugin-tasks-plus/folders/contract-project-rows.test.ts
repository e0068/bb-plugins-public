import { describe, expect, it } from "vitest";
import { foldersRpcContract, type ProjectRow, type ProjectRowBoard } from "./contract.js";

const output = foldersRpcContract.listProjectRows.output;
const connectInput = foldersRpcContract.connectDatabase.input;

const board: ProjectRowBoard = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZP1",
  name: "bb-plugins",
  prefix: "BBPL",
  color: "steelblue",
  icon: "Puzzle",
  taskCount: 816,
  tasksFolder: null,
  source: { kind: "database", url: "libsql://bbpl.turso.io", state: "live", lastSyncAt: null },
};

const live: ProjectRow = { bbProject: { id: "proj_plugins", name: "bb-plugins", repoPath: "/repos/bb-plugins" }, board };
const empty: ProjectRow = { bbProject: { id: "proj_personal", name: "Personal", repoPath: null }, board: null };
const orphan: ProjectRowBoard = { ...board, id: "01HZZZZZZZZZZZZZZZZZZZZZP2", prefix: "BP", icon: undefined, tasksFolder: "docs/tasks", source: { kind: "folder" } };

describe("the Projects tab's rows", () => {
  it("carry each bb project with its board or none, and the boards without a project as boards", () => {
    expect(output.parse({ projects: [live, empty], orphans: [orphan] })).toEqual({ projects: [live, empty], orphans: [orphan] });
  });

  it("have no project row without a bb project and no orphan without a board", () => {
    expect(output.safeParse({ projects: [{ bbProject: null, board }], orphans: [] }).success).toBe(false);
    expect(output.safeParse({ projects: [], orphans: [{ bbProject: null, board }] }).success).toBe(false);
    expect(output.safeParse({ projects: [], orphans: [null] }).success).toBe(false);
  });

  it("refuse a field the tab does not know", () => {
    expect(output.safeParse({ projects: [{ ...live, extra: true }], orphans: [] }).success).toBe(false);
  });

  it("are no longer complemented by a separate list of bb projects to pick from", () => {
    expect("listSyncableBbProjects" in foldersRpcContract).toBe(false);
  });
});

describe("connecting a database from a project's row", () => {
  it("names the bb project the new board belongs to", () => {
    expect(connectInput.parse({ url: "libsql://new.turso.io", bbProjectId: "proj_plugins" }).bbProjectId).toBe("proj_plugins");
  });

  it("takes only a bb project id there", () => {
    expect(connectInput.safeParse({ url: "libsql://new.turso.io", bbProjectId: "01HZZZZZZZZZZZZZZZZZZZZZP1" }).success).toBe(false);
  });
});
