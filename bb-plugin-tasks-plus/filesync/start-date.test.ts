// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mapFrontmatter } from "./map.js";
import { parseTaskFile, renderTaskFile } from "./task-file.js";
import { validateStartDate } from "./validators.js";

describe("validateStartDate", () => {
  it("lets a missing start date through", () => {
    expect(validateStartDate(null)).toBe(null);
  });

  it("accepts an ISO calendar date", () => {
    expect(validateStartDate("2026-09-20")).toBe("2026-09-20");
  });

  it("refuses a day-first date", () => {
    expect(() => validateStartDate("20.09.2026")).toThrow(/startDate/);
  });

  it("refuses a date that is not on the calendar", () => {
    expect(() => validateStartDate("2026-02-31")).toThrow(/startDate/);
  });
});

describe("start date in the task file header", () => {
  it("reads the start key", () => {
    const mapped = mapFrontmatter({ title: "T", start: "2026-09-20" }, "todo", "t");
    expect(mapped.startDate).toBe("2026-09-20");
  });

  it("reads a malformed start key as no start date", () => {
    const mapped = mapFrontmatter({ title: "T", start: "soon" }, "todo", "t");
    expect(mapped.startDate).toBe(null);
  });

  it("reads a file without a start key as no start date", () => {
    const mapped = mapFrontmatter({ title: "T" }, "todo", "t");
    expect(mapped.startDate).toBe(null);
  });

  it("writes the start key when the task has a start date", () => {
    const rendered = renderTaskFile(
      { title: "T", startDate: "2026-09-20", description: "" },
      "t",
      [],
    );
    expect(rendered).toContain("start: 2026-09-20");
  });

  it("leaves no start key when the task has no start date", () => {
    const rendered = renderTaskFile(
      { title: "T", startDate: null, description: "" },
      "t",
      [],
    );
    expect(rendered).not.toContain("start:");
  });

  it("carries the start date through a write and a read", () => {
    const rendered = renderTaskFile(
      { title: "T", startDate: "2026-09-20", dueDate: "2026-09-30", description: "" },
      "t",
      [],
    );
    const parsed = parseTaskFile(rendered, "todo", "t");
    expect(parsed.task.startDate).toBe("2026-09-20");
    expect(parsed.task.dueDate).toBe("2026-09-30");
  });
});
