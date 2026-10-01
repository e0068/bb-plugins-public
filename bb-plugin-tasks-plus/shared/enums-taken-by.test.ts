import { describe, expect, it } from "vitest";
import { BOARD_ONLY_FIELDS, FIELD_FILTER_KINDS, QUERY_FIELDS, ROW_FIELDS, VALUE_FILTER_FIELDS } from "./enums.js";

describe("Taken by is a field like any other", () => {
  it("stands right after Worktree in the canonical field order", () => {
    const fields: readonly string[] = ROW_FIELDS;
    expect(fields.indexOf("takenBy")).toBe(fields.indexOf("worktree") + 1);
  });

  it("is filtered by picked values and offered to filter and sort", () => {
    expect((FIELD_FILTER_KINDS as Record<string, string>).takenBy).toBe("values");
    expect(VALUE_FILTER_FIELDS as readonly string[]).toContain("takenBy");
    expect(QUERY_FIELDS as readonly string[]).toContain("takenBy");
  });

  it("belongs to the table as well as the board", () => {
    expect(BOARD_ONLY_FIELDS as readonly string[]).not.toContain("takenBy");
  });
});
