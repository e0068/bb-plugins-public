import { describe, expect, it } from "vitest";
import type { BoardGrouping, SavedViewFilters, Task } from "../../shared/contract.js";
import { boardColumns, dropPatch, dropsUnderItself } from "./grouping.js";

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";

const NO_FILTERS: SavedViewFilters = {
  statuses: [],
  priorities: [],
  types: [],
  estimates: [],
  labelNames: [],
  assignees: [],
  parents: [],
};

function task(id: string, key: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    projectId: PROJECT_ID,
    number: null,
    key,
    title: `Title ${key}`,
    description: "",
    status: "todo",
    priority: "none",
    dueDate: null,
    startDate: null,
    parentTaskId: null,
    epicId: null,
    position: 0,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    labelIds: [],
    type: null,
    estimate: null,
    plannedMinutes: null,
    actualMinutes: null,
    budget: null,
    budgetLimit: null,
    cost: null,
    source: null,
    ...patch,
  };
}

const byEpic: BoardGrouping = { groupBy: "epic", columns: {}, hideEmpty: false };
const layout = { filters: NO_FILTERS, sort: "manual" as const, grouping: byEpic };

describe("board grouped by epic", () => {
  const epic = task("E1", "TSK-1", { type: "epic" });
  const inner = task("E2", "TSK-2", { type: "epic", parentTaskId: "E1", epicId: "E1" });
  const child = task("C", "TSK-3", { parentTaskId: "E2", epicId: "E2" });
  const loose = task("L", "TSK-4");
  const tasks = [epic, inner, child, loose];

  it("draws a column per epic task, named by key and title, and one for tasks in no epic", () => {
    const columns = boardColumns(tasks, layout, []);
    expect(columns.map((column) => [column.key, column.label])).toEqual([
      ["E1", "TSK-1 Title TSK-1"],
      ["E2", "TSK-2 Title TSK-2"],
      ["none", "No epic"],
    ]);
  });

  it("puts each task in the column of its nearest epic", () => {
    const columns = new Map(boardColumns(tasks, layout, []).map((column) => [column.key, column.tasks.map((t) => t.id)]));
    expect(columns.get("E1")).toEqual(["E2"]);
    expect(columns.get("E2")).toEqual(["C"]);
    expect(columns.get("none")).toEqual(["E1", "L"]);
  });

  it("a drop into an epic's column makes the epic the parent; into No epic, takes the parent off", () => {
    expect(dropPatch(loose, "epic", "none", "E1", [])).toEqual({ kind: "patch", patch: { parentTaskId: "E1" } });
    expect(dropPatch(child, "epic", "E2", "none", [])).toEqual({ kind: "patch", patch: { parentTaskId: null } });
  });
});

describe("a drop that would put a task under itself", () => {
  const epic = task("E1", "TSK-1", { type: "epic" });
  const inner = task("E2", "TSK-2", { type: "epic", parentTaskId: "E1", epicId: "E1" });
  const other = task("E3", "TSK-5", { type: "epic" });
  const tasks = [epic, inner, other];

  it("is refused for the task's own column and the column of an epic under it, allowed elsewhere", () => {
    expect(dropsUnderItself(epic, "E1", tasks)).toBe(true);
    expect(dropsUnderItself(epic, "E2", tasks)).toBe(true);
    expect(dropsUnderItself(epic, "E3", tasks)).toBe(false);
    expect(dropsUnderItself(inner, "E3", tasks)).toBe(false);
    expect(dropsUnderItself(epic, "none", tasks)).toBe(false);
  });
});
