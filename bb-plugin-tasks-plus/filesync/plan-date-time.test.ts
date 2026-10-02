// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mapFrontmatter } from "./map.js";
import { parseTaskFile, renderTaskFile } from "./task-file.js";
import { validateDueDate, validateStartDate } from "./validators.js";

describe("plan dates with a time", () => {
  it("pass the start and due checks", () => {
    expect(validateStartDate("2026-10-01T15:00")).toBe("2026-10-01T15:00");
    expect(validateDueDate("2026-10-01T15:45")).toBe("2026-10-01T15:45");
  });

  it("are refused past 23:59, naming both forms", () => {
    expect(() => validateDueDate("2026-10-01T24:00")).toThrow(/YYYY-MM-DDTHH:mm/);
  });

  it("are read from the task file header", () => {
    const mapped = mapFrontmatter({ title: "T", start: "2026-10-01T15:00", due: "2026-10-01T15:45" }, "todo", "t");
    expect(mapped.startDate).toBe("2026-10-01T15:00");
    expect(mapped.dueDate).toBe("2026-10-01T15:45");
  });

  it("survive a write and a read", () => {
    const rendered = renderTaskFile({ title: "T", startDate: "2026-10-01T15:00", dueDate: "2026-10-01T15:45", description: "" }, "t", []);
    const parsed = parseTaskFile(rendered, "todo", "t");
    expect(parsed.task.startDate).toBe("2026-10-01T15:00");
    expect(parsed.task.dueDate).toBe("2026-10-01T15:45");
  });
});
