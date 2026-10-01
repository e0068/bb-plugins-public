import { describe, expect, it } from "vitest";
import { parentOptions } from "./parent-picker.js";

const task = (id: string, key: string, type: "epic" | "feature" | null, parentTaskId: string | null = null) => ({
  id,
  key,
  title: `Task ${key}`,
  type,
  parentTaskId,
});

describe("parentOptions", () => {
  const board = [
    task("F", "TSK-1", "feature"),
    task("E", "TSK-2", "epic"),
    task("ME", "TSK-3", null),
    task("C", "TSK-4", null, "ME"),
    task("G", "TSK-5", null, "C"),
    task("E2", "TSK-6", "epic"),
  ];

  it("offers neither the task itself nor anything under it", () => {
    const ids = parentOptions("ME", board).map((option) => option.id);
    expect(ids).not.toContain("ME");
    expect(ids).not.toContain("C");
    expect(ids).not.toContain("G");
    expect(ids).toContain("F");
  });

  it("puts the epics first, each group in board order", () => {
    expect(parentOptions("G", board).map((option) => option.key)).toEqual(["TSK-2", "TSK-6", "TSK-1", "TSK-3", "TSK-4"]);
  });
});
