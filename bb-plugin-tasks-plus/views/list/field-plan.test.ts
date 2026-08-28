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
    planTokens: null,
    factTokens: null,
    dueDate: null,
    parentTaskId: null,
    position: 1,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    labelIds: [],
    checks: [],
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

  it("createdAt and updatedAt (Edited) are never empty — every task has both", () => {
    expect(isRowFieldEmpty("createdAt", task(), CTX)).toBe(false);
    expect(isRowFieldEmpty("updatedAt", task({ status: "todo" }), CTX)).toBe(false);
    expect(isRowFieldEmpty("updatedAt", task({ status: "in_review" }), CTX)).toBe(false);
    expect(isRowFieldEmpty("updatedAt", task({ status: "done" }), CTX)).toBe(false);
  });

  it("tokens is empty only when both plan and fact are absent", () => {
    expect(isRowFieldEmpty("tokens", task(), CTX)).toBe(true);
    expect(isRowFieldEmpty("tokens", task({ planTokens: 10 }), CTX)).toBe(false);
    expect(isRowFieldEmpty("tokens", task({ factTokens: 10 }), CTX)).toBe(false);
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
  it("draws visible non-empty fields in configured order, dropping empties", () => {
    // Default list config, a task with a due date and one label only.
    const filled = task({
      dueDate: "2026-08-01",
      labelIds: ["01HZZZZZZZZZZZZZZZZZZZZZL1"],
    });
    const cells = planRowFields(defaultConfig("list"), filled, CTX);
    expect(cells.map((cell) => cell.field)).toEqual(["labels", "dueDate"]);
    expect(cells.every((cell) => cell.mode === "value")).toBe(true);
  });

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

  it("renders placeholders for empty visible fields when showEmpty is on", () => {
    const config: FieldDisplayConfig = { ...defaultConfig("list"), showEmpty: true };
    const cells = planRowFields(config, task(), CTX);
    // Every default-visible field is empty for a bare task → all placeholders.
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((cell) => cell.mode === "placeholder")).toBe(true);
    expect(cells.map((cell) => cell.field)).toEqual([
      "active",
      "type",
      "estimate",
      "labels",
      "tokens",
      "dueDate",
      "project",
    ]);
  });

  it("mixes values and placeholders by each field's own emptiness", () => {
    const config: FieldDisplayConfig = { ...defaultConfig("list"), showEmpty: true };
    const cells = planRowFields(config, task({ type: "feature" }), CTX);
    const type = cells.find((cell) => cell.field === "type");
    const labels = cells.find((cell) => cell.field === "labels");
    expect(type?.mode).toBe("value");
    expect(labels?.mode).toBe("placeholder");
  });

  it("follows a reordered config", () => {
    const base = defaultConfig("list");
    const reordered: FieldDisplayConfig = {
      ...base,
      // Move dueDate before labels.
      fields: [
        { field: "dueDate", visible: true },
        ...base.fields.filter((entry) => entry.field !== "dueDate"),
      ],
    };
    const filled = task({ dueDate: "2026-08-01", labelIds: ["x"] });
    const cells = planRowFields(reordered, filled, CTX);
    expect(cells.map((cell) => cell.field)).toEqual(["dueDate", "labels"]);
  });
});
