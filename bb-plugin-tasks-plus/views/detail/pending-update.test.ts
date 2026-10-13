// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Task } from "../../shared/contract.js";
import { shownTask, withUpdate } from "./pending-update.js";

const TASK = {
  id: "p:onboarding",
  title: "Onboarding",
  status: "todo",
  priority: "none",
  labelIds: ["urgent"],
  properties: { topic: "hr", owner: "ann" },
  dueDate: "2026-10-01",
  updatedAt: "2026-10-13T10:00:00.000Z",
} as unknown as Task;

describe("a change shown before its write lands", () => {
  it("lays the changed fields, labels and properties over the task and keeps the rest", () => {
    const shown = withUpdate(TASK, { status: "done", labelIds: ["urgent", "later"], dueDate: null, propertyPatch: { set: { topic: "it" }, remove: ["owner"] } });

    expect(shown).toMatchObject({ title: "Onboarding", status: "done", priority: "none", labelIds: ["urgent", "later"], dueDate: null, properties: { topic: "it" } });
    expect(shown.properties).not.toHaveProperty("owner");
  });

  it("applies the changes on their way in order", () => {
    expect(shownTask(TASK, undefined, [{ labelIds: ["a"] }, { labelIds: ["a", "b"] }, { status: "done" }])).toMatchObject({ labelIds: ["a", "b"], status: "done" });
  });

  it("keeps a write's answer until the server's copy is as new, then follows the server", () => {
    const answered = { ...TASK, status: "done", updatedAt: "2026-10-13T10:00:05.000Z" } as Task;

    expect(shownTask(TASK, answered, []).status).toBe("done");
    expect(shownTask(TASK, { ...answered, updatedAt: TASK.updatedAt }, []).status).toBe("done");
    expect(shownTask({ ...TASK, status: "in_review", updatedAt: "2026-10-13T10:00:09.000Z" } as Task, answered, []).status).toBe("in_review");
    expect(shownTask({ ...TASK, id: "p:other" } as Task, answered, []).status).toBe("todo");
  });
});
