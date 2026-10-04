import { describe, expect, it } from "vitest";
import { dateFormatOf, hasIconChoice, iconShownOf, isDateColumn, withColumnDisplay } from "./column-display.js";

describe("a table column's display", () => {
  it("offers a format on the four date columns only", () => {
    expect(["startDate", "dueDate", "createdAt", "updatedAt"].every((column) => isDateColumn(column as never))).toBe(true);
    expect(isDateColumn("title")).toBe(false);
  });

  it("reads dates with hours and minutes until a format is chosen", () => {
    expect(dateFormatOf(undefined, "createdAt")).toBe("dateTime");
    expect(dateFormatOf({ createdAt: { format: "relative" } }, "createdAt")).toBe("relative");
  });

  it("shows the type's and estimate's icons and hides the dates' until switched", () => {
    expect(iconShownOf(undefined, "type")).toBe(true);
    expect(iconShownOf(undefined, "dueDate")).toBe(false);
    expect(iconShownOf({ dueDate: { icon: true }, type: { icon: false } }, "dueDate")).toBe(true);
    expect(iconShownOf({ type: { icon: false } }, "type")).toBe(false);
    expect(hasIconChoice("status")).toBe(false);
  });

  it("lays a choice over one column and keeps its other choices and the other columns", () => {
    const displays = withColumnDisplay({ createdAt: { icon: true }, dueDate: { format: "date" } }, "createdAt", { format: "relative" });
    expect(displays).toEqual({ createdAt: { icon: true, format: "relative" }, dueDate: { format: "date" } });
  });
});
