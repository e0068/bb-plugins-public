import { describe, expect, it } from "vitest";
import { parseSubtasks, showTaskArgs } from "./bb-tasks-commands";

describe("showTaskArgs", () => {
  it("asks `bb tasks show` for the task as JSON", () => {
    expect(showTaskArgs("BBPL-1")).toEqual(["tasks", "show", "BBPL-1", "--json"]);
  });
});

describe("parseSubtasks", () => {
  it("reads the direct sub-tasks with key, status and file name", () => {
    const stdout = JSON.stringify({
      task: { key: "BBPL-1" },
      subtasks: [
        { key: "BBPL-2", status: "in_progress", id: "p:two" },
        { key: "BBPL-3", status: "done" },
      ],
    });
    expect(parseSubtasks(stdout)).toEqual([
      { key: "BBPL-2", status: "in_progress", slug: "two" },
      { key: "BBPL-3", status: "done" },
    ]);
  });

  it("a task without sub-tasks → an empty list, not unreadable", () => {
    expect(parseSubtasks(JSON.stringify({ subtasks: [] }))).toEqual([]);
  });

  it("not JSON, no `subtasks` array, or a sub-task without a key → unreadable (null)", () => {
    expect(parseSubtasks("")).toBeNull();
    expect(parseSubtasks("{}")).toBeNull();
    expect(parseSubtasks(JSON.stringify({ subtasks: [{ status: "done" }] }))).toBeNull();
  });
});
