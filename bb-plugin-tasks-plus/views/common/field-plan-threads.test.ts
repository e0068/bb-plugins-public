import { describe, expect, it } from "vitest";
import type { Task } from "../../shared/contract.js";
import { isRowFieldEmpty, type FieldPlanContext } from "./field-plan.js";
import { ROW_FIELD_LABELS, defaultConfig } from "./row-field-preference.js";

const task = { id: "P1:t", title: "T", description: "", assignee: null } as unknown as Task;
const ctx = (threadCount?: number): FieldPlanContext => ({ activeCount: 0, showProject: false, hasProject: true, threadCount });

describe("the Assignee field — threads attached to a task", () => {
  it("is named Assignee, and the folder it replaced Folder", () => {
    expect(ROW_FIELD_LABELS.threads).toBe("Assignee");
    expect(ROW_FIELD_LABELS.assignee).toBe("Folder");
  });

  it("is empty for a task with no thread, whatever its folder holds", () => {
    expect(isRowFieldEmpty("threads", task, ctx())).toBe(true);
    expect(isRowFieldEmpty("threads", task, ctx(0))).toBe(true);
    expect(isRowFieldEmpty("threads", task, ctx(2))).toBe(false);
  });

  it("is hidden in the default views, the folder's column kept as it was", () => {
    for (const surface of ["list", "board"] as const) {
      const visible = defaultConfig(surface).fields.filter((entry) => entry.visible).map((entry) => entry.field);
      expect(visible).not.toContain("threads");
    }
  });
});
