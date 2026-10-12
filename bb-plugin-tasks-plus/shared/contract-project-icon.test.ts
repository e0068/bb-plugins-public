import { describe, expect, it } from "vitest";
import { projectSchema, tasksRpcContract } from "./contract.js";

const project = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZP1",
  name: "bb-plugins",
  prefix: "BBPL",
  nextTaskNumber: 9,
  color: "steelblue",
  folderId: null,
  linkedBbProjectId: "proj_hpqtcwvtsv",
  tasksFolder: null,
  database: { url: "libsql://bb-tasks-bbpl.turso.io" },
  createdAt: "2026-10-11T00:00:00.000Z",
};

const updateProjectInput = tasksRpcContract.updateProject.input;

describe("a project's icon", () => {
  it("travels with the project, and a project without one still passes", () => {
    expect(projectSchema.parse({ ...project, icon: "Rocket" }).icon).toBe("Rocket");
    expect(projectSchema.parse(project).icon).toBeUndefined();
  });

  it("can be the only thing a project update changes", () => {
    expect(updateProjectInput.parse({ projectId: project.id, icon: "Rocket" })).toEqual({ projectId: project.id, icon: "Rocket" });
  });

  it("is not blank in an update", () => {
    expect(updateProjectInput.safeParse({ projectId: project.id, icon: " " }).success).toBe(false);
  });
});
