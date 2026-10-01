import { describe, expect, it } from "vitest";
import { boardGroupingSchema, fieldDisplayConfigSchema } from "./contract.js";

const grouping = { groupBy: "none", columns: {}, hideEmpty: false } as const;
const fields = { fields: [], showEmpty: false, showDescription: false };

describe("a board view's grid columns", () => {
  it("takes auto and one to six columns, and a view saved before them", () => {
    for (const gridColumns of ["auto", 1, 6] as const) {
      expect(boardGroupingSchema.safeParse({ ...grouping, gridColumns }).success).toBe(true);
    }
    expect(boardGroupingSchema.safeParse(grouping).success).toBe(true);
  });

  it("rejects a count outside one to six", () => {
    for (const gridColumns of [0, 7, 2.5, "3"]) {
      expect(boardGroupingSchema.safeParse({ ...grouping, gridColumns }).success).toBe(false);
    }
  });
});

describe("a view's sub-task scope", () => {
  it("takes all, open and open-children, and a view saved before them", () => {
    for (const subtaskScope of ["all", "open", "open-children"]) {
      expect(fieldDisplayConfigSchema.safeParse({ ...fields, subtaskScope }).success).toBe(true);
    }
    expect(fieldDisplayConfigSchema.safeParse(fields).success).toBe(true);
  });

  it("rejects an unknown scope", () => {
    expect(fieldDisplayConfigSchema.safeParse({ ...fields, subtaskScope: "closed" }).success).toBe(false);
  });
});
