import { describe, expect, it } from "vitest";
import type { FileTaskOrigin } from "../db/types.js";
import { fileTaskOriginSchema, projectSchema, taskSchema, tasksDomainErrorSchema } from "./contract.js";

const takenBy = { machine: "Mac mini", threadId: "thr_x", at: "2026-09-30T12:00:00.000Z" };

const task = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZP1:glow",
  projectId: "01HZZZZZZZZZZZZZZZZZZZZZP1",
  number: 1,
  key: "TSK-1",
  title: "Glow",
  description: "",
  status: "in_progress",
  priority: "none",
  type: null,
  estimate: null,
  plannedMinutes: null,
  actualMinutes: null,
  budget: null,
  budgetLimit: null,
  cost: null,
  dueDate: null,
  startDate: null,
  parentTaskId: null,
  position: 0,
  createdAt: "2026-09-30T12:00:00.000Z",
  updatedAt: "2026-09-30T12:00:00.000Z",
  labelIds: [],
  source: null,
};

const project = {
  id: "01HZZZZZZZZZZZZZZZZZZZZZP1",
  name: "Board",
  prefix: "TSK",
  nextTaskNumber: 2,
  color: "blue",
  folderId: null,
  linkedBbProjectId: null,
  tasksFolder: null,
  createdAt: "2026-09-30T12:00:00.000Z",
};

describe("a task crosses the wire with who took it", () => {
  it("accepts a task with a mark, without one, and with the field absent", () => {
    expect(taskSchema.safeParse({ ...task, takenBy }).success).toBe(true);
    expect(taskSchema.safeParse({ ...task, takenBy: { ...takenBy, threadId: null } }).success).toBe(true);
    expect(taskSchema.safeParse({ ...task, takenBy: null }).success).toBe(true);
    expect(taskSchema.safeParse(task).success).toBe(true);
  });

  it("rejects a mark without a machine name", () => {
    expect(taskSchema.safeParse({ ...task, takenBy: { ...takenBy, machine: "" } }).success).toBe(false);
  });

  it("lets a task of a database board through, with the row version it was read at", () => {
    const source = { filePath: "libsql://board-me.turso.io/in_progress/glow.md", origin: { kind: "database", url: "libsql://board-me.turso.io" }, revision: 4 };
    expect(taskSchema.safeParse({ ...task, source }).success).toBe(true);
    expect(fileTaskOriginSchema.safeParse({ kind: "database", url: "libsql://board-me.turso.io" }).success).toBe(true);
  });

  it("types a database origin on the server side too", () => {
    const origin: FileTaskOrigin = { kind: "database", url: "libsql://board-me.turso.io" };
    expect(fileTaskOriginSchema.safeParse(origin).data).toEqual(origin);
  });
});

describe("a refusal to take a task is a result, not a crash", () => {
  it("carries the code and the mark of whoever took it first", () => {
    const refusal = { code: "task_already_taken", message: "TSK-1 is already taken on Mac mini in thread thr_x, 3 s ago", takenBy };
    expect(tasksDomainErrorSchema.safeParse(refusal).success).toBe(true);
  });

  it("still needs a message", () => {
    expect(tasksDomainErrorSchema.safeParse({ code: "task_already_taken", takenBy }).success).toBe(false);
  });
});

describe("a board says when it lives in a database", () => {
  it("accepts a project with a database address, with null, and without the field", () => {
    expect(projectSchema.safeParse({ ...project, database: { url: "libsql://board-me.turso.io" } }).success).toBe(true);
    expect(projectSchema.safeParse({ ...project, database: null }).success).toBe(true);
    expect(projectSchema.safeParse(project).success).toBe(true);
  });
});
