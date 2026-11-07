import { describe, expect, it } from "vitest";
import { totalText } from "./column-total-format.js";

describe("totalText — a column's total as the footer writes it", () => {
  it("writes the count of distinct values as a plain number, whatever the column", () => {
    expect(totalText("cost", "unique", 3)).toBe("3");
    expect(totalText("status", "unique", 12)).toBe("12");
  });

  it("writes dollars for the money columns and minutes for the time columns", () => {
    expect(totalText("cost", "sum", 4359.63)).toBe("$4359.63");
    expect(totalText("budget", "median", 12)).toBe("$12");
    expect(totalText("plannedMinutes", "sum", 150)).toBe("2h 30m");
    expect(totalText("actualMinutes", "median", 45)).toBe("45m");
  });

  it("writes a counted column's sum as a plain number", () => {
    expect(totalText("subtasks", "sum", 7)).toBe("7");
  });

  it("writes a dash where there is nothing to total", () => {
    expect(totalText("cost", "sum", null)).toBe("—");
    expect(totalText("cost", "median", null)).toBe("—");
  });
});
