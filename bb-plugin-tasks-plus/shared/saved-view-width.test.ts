import { describe, expect, it } from "vitest";
import { boardGroupingSchema } from "./contract";
import { COLUMN_WIDTH_LIMITS } from "./board-column-width";

// A saved view carries column widths; the schema no longer knows the owner's bounds, only the hard limits.

const viewWith = (width: number) => ({
  groupBy: "status",
  columns: { status: { order: [], hidden: [], widths: { todo: width } } },
  hideEmpty: false,
});

describe("a saved view's column width", () => {
  it("opens at a width the old 200–480 range refused, such as 700 px", () => {
    expect(boardGroupingSchema.safeParse(viewWith(700)).success).toBe(true);
  });

  it("opens at a width below the old minimum, such as 120 px", () => {
    expect(boardGroupingSchema.safeParse(viewWith(120)).success).toBe(true);
  });

  it("still refuses a width outside the hard limits", () => {
    expect(boardGroupingSchema.safeParse(viewWith(COLUMN_WIDTH_LIMITS.floor)).success).toBe(true);
    expect(boardGroupingSchema.safeParse(viewWith(COLUMN_WIDTH_LIMITS.floor - 1)).success).toBe(false);
    expect(boardGroupingSchema.safeParse(viewWith(COLUMN_WIDTH_LIMITS.ceiling)).success).toBe(true);
    expect(boardGroupingSchema.safeParse(viewWith(COLUMN_WIDTH_LIMITS.ceiling + 1)).success).toBe(false);
  });
});
