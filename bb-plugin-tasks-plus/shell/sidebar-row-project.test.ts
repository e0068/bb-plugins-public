import { describe, expect, it } from "vitest";
import { projectOfGroupRow, projectOfThreadHref, rowBoardOf } from "./sidebar-row-project";

const PROJECTS = [
  { id: "proj_a1", name: "bb-plugins" },
  { id: "proj_b2", name: "Twin" },
  { id: "proj_c3", name: "Twin" },
];
const thread = (project: string) => `/projects/${project}/threads/thr_x${project}`;

describe("the bb project of a project row in the thread list", () => {
  it("is the one project of its name, even with a thread of another project under it", () => {
    expect(projectOfGroupRow({ name: "bb-plugins", threadHrefs: [thread("proj_a1"), thread("proj_b2"), thread("proj_a1")] }, PROJECTS)).toBe("proj_a1");
    expect(projectOfGroupRow({ name: "bb-plugins", threadHrefs: [] }, PROJECTS)).toBe("proj_a1");
  });

  it("is, among projects of one name, the one most of its threads name", () => {
    expect(projectOfGroupRow({ name: "Twin", threadHrefs: [thread("proj_c3"), thread("proj_b2"), thread("proj_c3")] }, PROJECTS)).toBe("proj_c3");
  });

  it("is, for a name not known yet, the project most of its threads name", () => {
    expect(projectOfGroupRow({ name: "Renamed", threadHrefs: [thread("proj_c3"), thread("proj_c3"), thread("proj_a1")] }, PROJECTS)).toBe("proj_c3");
  });

  it("is unknown when nothing settles it: twins without threads or with as many each, a stranger without threads", () => {
    expect(projectOfGroupRow({ name: "Twin", threadHrefs: [] }, PROJECTS)).toBeNull();
    expect(projectOfGroupRow({ name: "Twin", threadHrefs: [thread("proj_b2"), thread("proj_c3")] }, PROJECTS)).toBeNull();
    expect(projectOfGroupRow({ name: "Nobody", threadHrefs: [] }, PROJECTS)).toBeNull();
  });
});

describe("the board a project row wears the icon of", () => {
  const board = { id: "B1", icon: "🚀", color: "steelblue", linkedBbProjectId: "proj_a1", database: null };
  const section = { id: "S1", icon: "📄", color: "red", linkedBbProjectId: "proj_a1", database: { table: "docs0001" } };

  it("is the task board linked to the project, not a section beside it", () => {
    expect(rowBoardOf("proj_a1", [section, board])).toEqual({ boardId: "B1", icon: "🚀", color: "steelblue" });
  });

  it("is none for a project no board is linked to", () => {
    expect(rowBoardOf("proj_b2", [section, board])).toBeNull();
  });
});

describe("the project a thread row's link names", () => {
  it("is the project of a thread link", () => {
    expect(projectOfThreadHref("/projects/proj_a1/threads/thr_1")).toBe("proj_a1");
  });

  it("is none for a link that names no project: a personal thread, a missing link", () => {
    expect(projectOfThreadHref("/threads/thr_1")).toBeNull();
    expect(projectOfThreadHref(null)).toBeNull();
  });
});
