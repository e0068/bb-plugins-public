import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  TASK_ESTIMATES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
  type BoardGroupBy,
} from "../../shared/enums.js";
import type { BoardGrouping, Label, SavedViewFilters, Task } from "../../shared/contract.js";
import {
  boardColumns,
  canReorder,
  columnWidth,
  dropPatch,
  withColumnOrder,
  withColumnWidth,
  withHiddenToggled,
  withDrop,
  placedBefore,
} from "./grouping.js";

const PROJECT_ID = "01HZZZZZZZZZZZZZZZZZZZZZP1";

const LABELS: Label[] = [
  { id: "01HZZZZZZZZZZZZZZZZZZZZZL1", projectId: PROJECT_ID, name: "bug", color: "red" },
  { id: "01HZZZZZZZZZZZZZZZZZZZZZL2", projectId: PROJECT_ID, name: "ui", color: "green" },
  { id: "01HZZZZZZZZZZZZZZZZZZZZZL3", projectId: PROJECT_ID, name: "flow", color: "blue" },
];

const NO_FILTERS: SavedViewFilters = {
  statuses: [],
  priorities: [],
  types: [],
  estimates: [],
  labelNames: [],
  assignees: [],
  parents: [],
};

function task(number: number, patch: Partial<Task> = {}): Task {
  return {
    id: `01HZZZZZZZZZZZZZZZZZZZZZT${number}`,
    projectId: PROJECT_ID,
    number,
    key: `TSK-${number}`,
    title: `Task ${number}`,
    description: "",
    status: "todo",
    priority: "none",
    dueDate: null,
    startDate: null,
    parentTaskId: null,
    position: number,
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

const grouping = (groupBy: BoardGroupBy, patch: Partial<BoardGrouping> = {}): BoardGrouping => ({
  groupBy,
  columns: {},
  hideEmpty: false,
  ...patch,
});

const layout = (groupBy: BoardGroupBy, patch: Partial<BoardGrouping> = {}) => ({
  filters: NO_FILTERS,
  sort: "manual" as const,
  grouping: grouping(groupBy, patch),
});

const keys = (columns: { key: string }[]) => columns.map((column) => column.key);

const arbTask = fc
  .record({
    number: fc.integer({ min: 1, max: 9 }),
    status: fc.constantFrom(...TASK_STATUSES),
    priority: fc.constantFrom(...TASK_PRIORITIES),
    type: fc.constantFrom(null, ...TASK_TYPES),
    estimate: fc.constantFrom(null, ...TASK_ESTIMATES),
    assignee: fc.constantFrom(null, "sergey", "agent"),
    epic: fc.constantFrom(null, "Flow v2"),
    labelIds: fc.subarray(LABELS.map((label) => label.id)),
  })
  .map(({ number, ...patch }) => task(number, patch));

const arbTasks = fc.array(arbTask, { maxLength: 12 }).map((tasks) =>
  tasks.map((entry, index) => ({ ...entry, id: `${entry.id}-${index}` })),
);

const arbGroupBy = fc.constantFrom<BoardGroupBy>(
  "status",
  "priority",
  "type",
  "estimate",
  "assignee",
  "label",
);

/** The column keys a task belongs to under a property — the spec, spelled out. */
function expectedKeys(entry: Task, groupBy: BoardGroupBy): string[] {
  switch (groupBy) {
    case "status":
      return [entry.status];
    case "priority":
      return [entry.priority];
    case "type":
      return [entry.type ?? "none"];
    case "estimate":
      return [entry.estimate ?? "none"];
    case "assignee":
      return [entry.assignee ?? "none"];
    case "label": {
      const names = LABELS.filter((label) => entry.labelIds.includes(label.id)).map(
        (label) => label.name,
      );
      return names.length > 0 ? names : ["none"];
    }
    case "none":
      return [];
  }
}

describe("boardColumns", () => {
  it("puts every task in the column of each of its field values, and nowhere else", () => {
    const byField = fc.constantFrom<BoardGroupBy>("status", "priority", "type", "estimate", "assignee", "label");
    fc.assert(
      fc.property(arbTasks, byField, (tasks, groupBy) => {
        const columns = boardColumns(tasks, layout(groupBy), LABELS);
        for (const entry of tasks) {
          const holding = columns
            .filter((column) => column.tasks.some((shown) => shown.id === entry.id))
            .map((column) => column.key)
            .sort();
          expect(holding).toEqual(expectedKeys(entry, groupBy).sort());
        }
      }),
    );
  });

  it("never draws a column the owner hid", () => {
    fc.assert(
      fc.property(arbTasks, arbGroupBy, fc.array(fc.string()), (tasks, groupBy, hidden) => {
        const settings = { order: [], hidden, widths: {} };
        const columns = boardColumns(
          tasks,
          layout(groupBy, { columns: { [groupBy]: settings } }),
          LABELS,
        );
        expect(keys(columns).filter((key) => hidden.includes(key))).toEqual([]);
      }),
    );
  });

  it("puts the owner's order first and keeps every other column after it", () => {
    fc.assert(
      fc.property(fc.shuffledSubarray([...TASK_PRIORITIES]), (order) => {
        const columns = boardColumns(
          [],
          layout("priority", { columns: { priority: { order, hidden: [], widths: {} } } }),
          LABELS,
        );
        expect(keys(columns).slice(0, order.length)).toEqual(order);
        expect([...keys(columns)].sort()).toEqual([...TASK_PRIORITIES].sort());
      }),
    );
  });

  it("lays the status columns out in board order and shows Canceled only when it holds cards", () => {
    expect(keys(boardColumns([task(1)], layout("status"), LABELS))).toEqual([
      "backlog",
      "todo",
      "in_progress",
      "in_review",
      "done",
    ]);
    expect(
      keys(boardColumns([task(1, { status: "canceled" })], layout("status"), LABELS)),
    ).toContain("canceled");
  });

  it("names the empty value's column after the property", () => {
    const labelOf = (groupBy: BoardGroupBy) =>
      boardColumns([task(1)], layout(groupBy), LABELS).find((column) => column.key === "none")
        ?.label;
    expect(labelOf("type")).toBe("No type");
    expect(labelOf("estimate")).toBe("No estimate");
    expect(labelOf("assignee")).toBe("No assignee");
    expect(labelOf("label")).toBe("No label");
    expect(labelOf("priority")).toBe("No priority");
  });

  it("offers the assignees the board's tasks use", () => {
    const tasks = [task(1, { assignee: "sergey" }), task(2, { assignee: "agent" })];
    expect(keys(boardColumns(tasks, layout("assignee"), LABELS))).toEqual([
      "agent",
      "sergey",
      "none",
    ]);
  });

  it("offers every label of the project, in the project's order", () => {
    expect(keys(boardColumns([], layout("label"), LABELS))).toEqual(["bug", "ui", "flow", "none"]);
  });

  it("filters the cards and counts only what passed", () => {
    const tasks = [task(1, { priority: "high" }), task(2, { priority: "low" })];
    const columns = boardColumns(
      tasks,
      { ...layout("status"), filters: { ...NO_FILTERS, priorities: ["high"] } },
      LABELS,
    );
    expect(columns.find((column) => column.key === "todo")?.tasks.map((t) => t.key)).toEqual([
      "TSK-1",
    ]);
  });

  it("filters by label name", () => {
    const tasks = [task(1, { labelIds: [LABELS[0]!.id] }), task(2)];
    const columns = boardColumns(
      tasks,
      { ...layout("status"), filters: { ...NO_FILTERS, labelNames: ["bug"] } },
      LABELS,
    );
    expect(columns.flatMap((column) => column.tasks).map((t) => t.key)).toEqual(["TSK-1"]);
  });

  it("keeps only the filtered columns of the property it groups by", () => {
    const columns = boardColumns(
      [task(1)],
      { ...layout("status"), filters: { ...NO_FILTERS, statuses: ["todo", "done"] } },
      LABELS,
    );
    expect(keys(columns)).toEqual(["todo", "done"]);
  });

  it("drops empty columns when asked to", () => {
    const columns = boardColumns([task(1)], layout("status", { hideEmpty: true }), LABELS);
    expect(keys(columns)).toEqual(["todo"]);
  });

  it("orders each column by the chosen sort", () => {
    const tasks = [task(1, { priority: "low" }), task(2, { priority: "urgent" })];
    const columns = boardColumns(tasks, { ...layout("status"), sort: "priority" }, LABELS);
    expect(columns.find((column) => column.key === "todo")?.tasks.map((t) => t.key)).toEqual([
      "TSK-2",
      "TSK-1",
    ]);
  });

  it("draws one column of everything when nothing groups the board", () => {
    const columns = boardColumns([task(1), task(2, { status: "done" })], layout("none"), LABELS);
    expect(keys(columns)).toEqual(["all"]);
    expect(columns[0]!.tasks).toHaveLength(2);
  });

  it("ignores an order entry that names no column", () => {
    const columns = boardColumns(
      [],
      layout("estimate", { columns: { estimate: { order: ["huge", "l"], hidden: [], widths: {} } } }),
      LABELS,
    );
    expect(keys(columns)[0]).toBe("l");
    expect(keys(columns)).not.toContain("huge");
  });
});

describe("dropPatch", () => {
  it("sets the grouped field to the column's value", () => {
    expect(dropPatch(task(1), "priority", "none", "high", LABELS)).toEqual({ kind: "patch", patch: { priority: "high" } });
    expect(dropPatch(task(1), "type", "none", "bugfix", LABELS)).toEqual({ kind: "patch", patch: { type: "bugfix" } });
    expect(dropPatch(task(1, { estimate: "m" }), "estimate", "m", "none", LABELS)).toEqual({ kind: "patch", patch: { estimate: null } });
    expect(dropPatch(task(1), "assignee", "none", "sergey", LABELS)).toEqual({ kind: "patch", patch: { assignee: "sergey" } });
  });

  it("changes nothing when the card lands in its own column", () => {
    fc.assert(
      fc.property(arbTask, arbGroupBy, fc.string(), (entry, groupBy, key) => {
        expect(dropPatch(entry, groupBy, key, key, LABELS)).toEqual({ kind: "none" });
      }),
    );
  });

  it("moves a card between status columns by status", () => {
    expect(dropPatch(task(1), "status", "todo", "done", LABELS)).toEqual({
      kind: "status",
      status: "done",
    });
  });

  it("swaps the source label for the target label and keeps the others", () => {
    const [bug, ui, flow] = LABELS.map((label) => label.id);
    const entry = task(1, { labelIds: [bug!, flow!] });
    expect(dropPatch(entry, "label", "bug", "ui", LABELS)).toEqual({
      kind: "patch",
      patch: { labelIds: [flow!, ui!] },
    });
    expect(dropPatch(entry, "label", "bug", "none", LABELS)).toEqual({
      kind: "patch",
      patch: { labelIds: [flow!] },
    });
    expect(dropPatch(task(2), "label", "none", "bug", LABELS)).toEqual({
      kind: "patch",
      patch: { labelIds: [bug!] },
    });
  });

  it("refuses a column that is not a value of the property", () => {
    expect(dropPatch(task(1), "status", "todo", "later", LABELS)).toEqual({ kind: "none" });
    expect(dropPatch(task(1), "priority", "none", "none-ish", LABELS)).toEqual({ kind: "none" });
    expect(dropPatch(task(1), "label", "none", "ghost", LABELS)).toEqual({ kind: "none" });
    expect(dropPatch(task(1), "none", "all", "all", LABELS)).toEqual({ kind: "none" });
  });
});

describe("canReorder", () => {
  it("lets cards be reordered in the manual order of status columns and of the ungrouped grid", () => {
    expect(canReorder("status", "manual")).toBe(true);
    expect(canReorder("none", "manual")).toBe(true);
    expect(canReorder("status", "priority")).toBe(false);
    expect(canReorder("none", "priority")).toBe(false);
    expect(canReorder("priority", "manual")).toBe(false);
  });
});

describe("column settings", () => {
  it("clamps a dragged width into the allowed range and reads it back", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 3000 }), (width) => {
        const next = withColumnWidth(grouping("priority"), "high", width);
        const read = columnWidth(next, "high");
        expect(read).toBeGreaterThanOrEqual(200);
        expect(read).toBeLessThanOrEqual(480);
      }),
    );
  });

  it("gives an untouched column the default width", () => {
    expect(columnWidth(grouping("status"), "todo")).toBe(230);
  });

  it("keeps widths apart per property", () => {
    const next = withColumnWidth(grouping("priority"), "high", 300);
    expect(columnWidth({ ...next, groupBy: "status" }, "high")).toBe(230);
  });

  it("hides and shows a column again", () => {
    const hidden = withHiddenToggled(grouping("status"), "done");
    expect(hidden.columns.status?.hidden).toEqual(["done"]);
    expect(withHiddenToggled(hidden, "done").columns.status?.hidden).toEqual([]);
  });

  it("stores a new column order for the grouped property", () => {
    const next = withColumnOrder(grouping("priority"), ["low", "high"]);
    expect(next.columns.priority?.order).toEqual(["low", "high"]);
  });

  it("does not store settings when nothing groups the board", () => {
    const flat = grouping("none");
    expect(withColumnWidth(flat, "all", 300)).toEqual(flat);
    expect(withHiddenToggled(flat, "all")).toEqual(flat);
    expect(withColumnOrder(flat, ["all"])).toEqual(flat);
  });
});

describe("a drop applied to the board before the server answers", () => {
  const tasks = [task(1), task(2), task(3, { status: "done" })];

  it("moves the card to its new status and leaves the others alone", () => {
    const next = withDrop(tasks, tasks[0]!.id, { kind: "status", status: "done" });
    expect(next.map((entry) => entry.status)).toEqual(["done", "todo", "done"]);
    expect(tasks[0]!.status).toBe("todo");
  });

  it("sets the grouped property on the card", () => {
    const next = withDrop(tasks, tasks[1]!.id, { kind: "patch", patch: { priority: "high" } });
    expect(next[1]!.priority).toBe("high");
  });

  it("changes nothing for no change", () => {
    expect(withDrop(tasks, tasks[0]!.id, { kind: "none" })).toEqual(tasks);
  });

  it("places a card before the card that follows it, or last", () => {
    const ids = (list: Task[]) => list.map((entry) => entry.key);
    expect(ids(placedBefore(tasks, tasks[2]!.id, tasks[0]!.id))).toEqual(["TSK-3", "TSK-1", "TSK-2"]);
    expect(ids(placedBefore(tasks, tasks[0]!.id, null))).toEqual(["TSK-2", "TSK-3", "TSK-1"]);
    expect(ids(placedBefore(tasks, "missing", null))).toEqual(ids(tasks));
  });
});
