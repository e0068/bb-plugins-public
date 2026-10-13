import { describe, expect, it } from "vitest";
import { projectSchema } from "./contract.js";

const section = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZP2",
  name: "Specs",
  prefix: "SPE",
  nextTaskNumber: 1,
  color: "steelblue",
  folderId: null,
  linkedBbProjectId: null,
  tasksFolder: null,
  database: { url: "libsql://team-me.turso.io", table: "specs001" },
  createdAt: "2026-10-13T00:00:00.000Z",
};

describe("a section's place in the project", () => {
  it("travels with the board: the section it sits in, or none for a top one", () => {
    expect(projectSchema.parse({ ...section, database: { ...section.database, parent: "docs0001" } }).database?.parent).toBe("docs0001");
    expect(projectSchema.parse(section).database?.parent).toBeUndefined();
  });
});
