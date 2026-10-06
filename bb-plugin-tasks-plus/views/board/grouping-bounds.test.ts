import { describe, expect, it } from "vitest";
import type { BoardGrouping } from "../../shared/contract";
import { columnWidth, withColumnWidth } from "./grouping";
import { DEFAULT_COLUMN_WIDTH_BOUNDS } from "../../shared/board-column-width";

// The owner's bounds reach the board's width helpers as a last argument; the board reads them from the settings.

const WIDE = { min: 150, initial: 320, max: 900 } as const;

const grouping = (groupBy: BoardGrouping["groupBy"]): BoardGrouping => ({ groupBy, columns: {}, hideEmpty: false });

describe("column widths under the owner's bounds", () => {
  it("draws an untouched column at the owner's default width", () => {
    expect(columnWidth(grouping("status"), "todo", WIDE)).toBe(320);
  });

  it("lets a drag reach the owner's maximum and minimum, not the old ones", () => {
    const stretched = withColumnWidth(grouping("priority"), "high", 2000, WIDE);
    expect(columnWidth(stretched, "high", WIDE)).toBe(900);
    const squeezed = withColumnWidth(grouping("priority"), "high", 10, WIDE);
    expect(columnWidth(squeezed, "high", WIDE)).toBe(150);
  });

  it("holds a width kept before the bounds narrowed inside them when it is read", () => {
    const kept = withColumnWidth(grouping("priority"), "high", 800, WIDE);
    expect(columnWidth(kept, "high", DEFAULT_COLUMN_WIDTH_BOUNDS)).toBe(480);
  });

  it("draws a board without grouping at the owner's default width", () => {
    expect(columnWidth(grouping("none"), "all", WIDE)).toBe(320);
  });
});
