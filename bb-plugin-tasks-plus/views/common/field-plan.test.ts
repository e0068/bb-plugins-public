import { describe, expect, it } from "vitest";
import type { Task } from "../../shared/contract.js";
import { isRowFieldEmpty, planRowFields, type FieldPlanContext } from "./field-plan.js";
import { defaultConfig, type FieldDisplayConfig } from "./row-field-preference.js";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "01HZZZZZZZZZZZZZZZZZZZZZT1",
    projectId: "01HZZZZZZZZZZZZZZZZZZZZZP1",
    number: 1,
    key: "TSK-1",
    title: "T",
    description: "",
    status: "todo",
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
    position: 1,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    labelIds: [],
    source: null,
    ...overrides,
  };
}

const CTX: FieldPlanContext = {
  activeCount: 0,
  showProject: false,
  hasProject: false,
};

describe("isRowFieldEmpty", () => {
  it("treats priority 'none' as empty and any real priority as present", () => {
    expect(isRowFieldEmpty("priority", task({ priority: "none" }), CTX)).toBe(true);
    expect(isRowFieldEmpty("priority", task({ priority: "high" }), CTX)).toBe(false);
  });

  it("reads active from the context count, not the task", () => {
    expect(isRowFieldEmpty("active", task(), CTX)).toBe(true);
    expect(isRowFieldEmpty("active", task(), { ...CTX, activeCount: 1 })).toBe(false);
  });

  it("assignee is empty outside an assignee folder, epic when no ancestor is an epic", () => {
    expect(isRowFieldEmpty("assignee", task(), CTX)).toBe(true);
    expect(isRowFieldEmpty("assignee", task({ assignee: "Claude" }), CTX)).toBe(false);
    expect(isRowFieldEmpty("epic", task({ epicId: null }), CTX)).toBe(true);
    expect(isRowFieldEmpty("epic", task({ epicId: "01HZZZZZZZZZZZZZZZZZZZZZE1" }), CTX)).toBe(false);
  });

  it("createdAt and updatedAt (Edited) are never empty — every task has both", () => {
    expect(isRowFieldEmpty("createdAt", task(), CTX)).toBe(false);
    expect(isRowFieldEmpty("updatedAt", task({ status: "todo" }), CTX)).toBe(false);
    expect(isRowFieldEmpty("updatedAt", task({ status: "in_review" }), CTX)).toBe(false);
    expect(isRowFieldEmpty("updatedAt", task({ status: "done" }), CTX)).toBe(false);
  });

  it.each([
    ["plannedMinutes"],
    ["actualMinutes"],
    ["budget"],
    ["budgetLimit"],
    ["cost"],
  ] as const)("%s is empty only while its own value is absent — zero counts", (field) => {
    expect(isRowFieldEmpty(field, task(), CTX)).toBe(true);
    expect(isRowFieldEmpty(field, task({ [field]: 0 }), CTX)).toBe(false);
  });

  it("project depends on the surface showing a resolved project", () => {
    expect(isRowFieldEmpty("project", task(), CTX)).toBe(true);
    expect(
      isRowFieldEmpty("project", task(), { ...CTX, showProject: true, hasProject: false }),
    ).toBe(true);
    expect(
      isRowFieldEmpty("project", task(), { ...CTX, showProject: true, hasProject: true }),
    ).toBe(false);
  });
});

describe("planRowFields", () => {

  it("hidden fields never appear even when filled", () => {
    const config: FieldDisplayConfig = {
      ...defaultConfig("list"),
      fields: defaultConfig("list").fields.map((entry) =>
        entry.field === "labels" ? { ...entry, visible: false } : entry,
      ),
    };
    const cells = planRowFields(config, task({ labelIds: ["x"] }), CTX);
    expect(cells.map((cell) => cell.field)).not.toContain("labels");
  });

  it("mixes values and placeholders by each field's own emptiness", () => {
    const config: FieldDisplayConfig = { ...defaultConfig("list"), showEmpty: true };
    const cells = planRowFields(config, task({ type: "feature" }), CTX);
    const type = cells.find((cell) => cell.field === "type");
    const labels = cells.find((cell) => cell.field === "labels");
    expect(type?.mode).toBe("value");
    expect(labels?.mode).toBe("placeholder");
  });
});

describe("the key field", () => {
  it("is never empty — every task has a key", () => {
    expect(isRowFieldEmpty("key", task(), { activeCount: 0, showProject: false, hasProject: false })).toBe(false);
  });
});

describe("planRowFields with the key", () => {
  it("draws the key first, then visible non-empty fields in configured order, dropping empties", () => {
    const filled = task({ dueDate: "2026-08-01", labelIds: ["01HZZZZZZZZZZZZZZZZZZZZZL1"] });
    const cells = planRowFields(defaultConfig("list"), filled, CTX);
    expect(cells.map((cell) => cell.field)).toEqual(["key", "labels", "dueDate"]);
    expect(cells.every((cell) => cell.mode === "value")).toBe(true);
  });

  it("with showEmpty on, a bare task gets its key as a value and a placeholder for every other default-visible field", () => {
    const config: FieldDisplayConfig = { ...defaultConfig("list"), showEmpty: true };
    const cells = planRowFields(config, task(), CTX);
    expect(cells.map((cell) => cell.field)).toEqual(
      config.fields.filter((entry) => entry.visible).map((entry) => entry.field),
    );
    expect(cells.filter((cell) => cell.mode === "value").map((cell) => cell.field)).toEqual(["key"]);
  });

  it("follows a reordered config, the key included", () => {
    const base = defaultConfig("list");
    const reordered: FieldDisplayConfig = {
      ...base,
      fields: [
        { field: "dueDate", visible: true },
        ...base.fields.filter((entry) => entry.field !== "dueDate"),
      ],
    };
    const cells = planRowFields(reordered, task({ dueDate: "2026-08-01", labelIds: ["x"] }), CTX);
    expect(cells.map((cell) => cell.field)).toEqual(["dueDate", "key", "labels"]);
  });
});

describe("the card's own fields", () => {
  const worktree = { filePath: "/wt/docs/tasks/todo/t.md", origin: { kind: "worktree", environmentId: "env_1", name: null, branchName: "bb/t" } } as unknown as Task["source"];

  it("never leaves the title empty", () => {
    expect(isRowFieldEmpty("title", task(), CTX)).toBe(false);
  });

  it("marks the parent only on a task under another", () => {
    expect(isRowFieldEmpty("parent", task(), CTX)).toBe(true);
    expect(isRowFieldEmpty("parent", task({ parentTaskId: "01HZZZZZZZZZZZZZZZZZZZZZT9" }), CTX)).toBe(false);
  });

  it("draws the paperclip only when the task has attachments", () => {
    expect(isRowFieldEmpty("attachments", task(), CTX)).toBe(true);
    expect(isRowFieldEmpty("attachments", task(), { ...CTX, attachmentCount: 0 })).toBe(true);
    expect(isRowFieldEmpty("attachments", task(), { ...CTX, attachmentCount: 2 })).toBe(false);
  });

  it("draws the worktree mark only on a task read from a thread's worktree", () => {
    expect(isRowFieldEmpty("worktree", task(), CTX)).toBe(true);
    expect(isRowFieldEmpty("worktree", task({ source: worktree }), CTX)).toBe(false);
  });
});
