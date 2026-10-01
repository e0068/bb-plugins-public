import { describe, expect, it } from "vitest";
import { ROW_FIELD_LABELS, defaultConfig } from "./row-field-preference.js";

describe("Taken by in the Display menu", () => {
  it("is labelled Taken by", () => {
    expect((ROW_FIELD_LABELS as Record<string, string>).takenBy).toBe("Taken by");
  });

  it("is offered on the board and in the table, and off by default on both", () => {
    for (const surface of ["board", "list"] as const) {
      const entry = defaultConfig(surface).fields.find((field) => (field.field as string) === "takenBy");
      expect(entry, `${surface} offers Taken by`).toBeDefined();
      expect(entry?.visible).toBe(false);
    }
  });

  it("follows Worktree in the default order", () => {
    const fields = defaultConfig("board").fields.map((entry) => entry.field as string);
    expect(fields.indexOf("takenBy")).toBe(fields.indexOf("worktree") + 1);
  });
});
