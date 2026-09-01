import { describe, expect, it } from "vitest";
import type { Label, Task } from "../../shared/contract.js";
import {
  activeWorkLabel,
  formatDueDate,
  groupTasksByStatus,
  labelFilterOptions,
  nestSubtasks,
  partitionLabels,
  selectedLabelIds,
} from "./lib.js";

const ULID_A = "01ARZ3NDEKTSV4RRFFQ69G5FAA";
const ULID_B = "01ARZ3NDEKTSV4RRFFQ69G5FAB";
const ULID_C = "01ARZ3NDEKTSV4RRFFQ69G5FAC";
const ULID_D = "01ARZ3NDEKTSV4RRFFQ69G5FAD";

function task(overrides: Partial<Task> & Pick<Task, "id" | "status">): Task {
  return {
    projectId: ULID_A,
    number: 1,
    key: "TSK-1",
    title: "A task",
    description: "",
    priority: "none",
    dueDate: null,
    parentTaskId: null,
    position: 0,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    labelIds: [],
    ...overrides,
  };
}

describe("nestSubtasks", () => {
  it("nests a subtask directly after its parent, grouped under the parent's status", () => {
    const parent = task({ id: ULID_A, status: "in_progress" });
    const child = task({
      id: ULID_B,
      status: "todo",
      parentTaskId: ULID_A,
    });
    expect(nestSubtasks([parent, child])).toEqual([
      { task: parent, depth: 0, groupStatus: "in_progress" },
      { task: child, depth: 1, groupStatus: "in_progress" },
    ]);
  });

  it("keeps multiple children in their incoming order after the parent", () => {
    const parent = task({ id: ULID_A, status: "todo" });
    const first = task({ id: ULID_B, status: "todo", parentTaskId: ULID_A });
    const second = task({ id: ULID_C, status: "done", parentTaskId: ULID_A });
    expect(nestSubtasks([parent, first, second]).map((e) => e.task.id)).toEqual(
      [ULID_A, ULID_B, ULID_C],
    );
  });

  it("falls back to depth 0 under its own status when the parent isn't in the list", () => {
    const orphan = task({
      id: ULID_B,
      status: "todo",
      parentTaskId: ULID_A,
    });
    expect(nestSubtasks([orphan])).toEqual([
      { task: orphan, depth: 0, groupStatus: "todo" },
    ]);
  });

  it("returns nothing for no tasks", () => {
    expect(nestSubtasks([])).toEqual([]);
  });
});

describe("groupTasksByStatus", () => {
  it("orders groups canonically and hides empty ones", () => {
    const groups = groupTasksByStatus(
      nestSubtasks([
        task({ id: ULID_A, status: "done" }),
        task({ id: ULID_B, status: "todo" }),
        task({ id: ULID_C, status: "todo" }),
      ]),
    );
    expect(groups.map((g) => g.status)).toEqual(["todo", "done"]);
    expect(groups[0]?.entries.map((e) => e.task.id)).toEqual([ULID_B, ULID_C]);
  });

  it("buckets a nested subtask under its parent's status group", () => {
    const parent = task({ id: ULID_A, status: "done" });
    const child = task({
      id: ULID_D,
      status: "todo",
      parentTaskId: ULID_A,
    });
    const groups = groupTasksByStatus(nestSubtasks([parent, child]));
    expect(groups.map((g) => g.status)).toEqual(["done"]);
    expect(groups[0]?.entries.map((e) => e.task.id)).toEqual([
      ULID_A,
      ULID_D,
    ]);
  });

  it("returns nothing for no tasks", () => {
    expect(groupTasksByStatus([])).toEqual([]);
  });
});

describe("label filter options", () => {
  const label = (id: string, projectId: string, name: string): Label => ({
    id,
    projectId,
    name,
    color: "#5e6ad2",
  });

  it("merges same-named labels across projects and resolves ids", () => {
    const options = labelFilterOptions([
      label(ULID_A, ULID_A, "Bug"),
      label(ULID_B, ULID_B, "Bug"),
      label(ULID_C, ULID_A, "Feature"),
    ]);
    expect(options.map((o) => o.name)).toEqual(["Bug", "Feature"]);
    expect(selectedLabelIds(options, ["Bug"])).toEqual([ULID_A, ULID_B]);
    expect(selectedLabelIds(options, [])).toEqual([]);
  });
});

describe("formatDueDate", () => {
  it("omits the current year and shows other years", () => {
    const today = new Date("2026-07-15T12:00:00");
    expect(formatDueDate("2026-07-18", today)).toBe("Jul 18");
    expect(formatDueDate("2027-01-02", today)).toBe("Jan 2, 2027");
  });
});

describe("activeWorkLabel", () => {
  it("distinguishes starting from working for a single agent", () => {
    expect(activeWorkLabel([{ liveStatus: "starting" }])).toBe(
      "Agent starting",
    );
    expect(activeWorkLabel([{ liveStatus: "working" }])).toBe("Agent working");
  });

  it("counts multiple live agents", () => {
    expect(
      activeWorkLabel([{ liveStatus: "working" }, { liveStatus: "starting" }]),
    ).toBe("2 agents working");
  });
});

describe("partitionLabels", () => {
  const label = (name: string): Label => ({
    id: name,
    projectId: ULID_A,
    name,
    color: "#5e6ad2",
  });

  it("keeps everything visible at or under the cap", () => {
    const labels = [label("a"), label("b")];
    expect(partitionLabels(labels, 2)).toEqual({
      visible: labels,
      hidden: [],
    });
    expect(partitionLabels([], 2)).toEqual({ visible: [], hidden: [] });
  });

  it("moves the tail into hidden above the cap", () => {
    const labels = [label("a"), label("b"), label("c")];
    expect(partitionLabels(labels, 1)).toEqual({
      visible: [labels[0]],
      hidden: [labels[1], labels[2]],
    });
  });
});
