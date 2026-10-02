// @vitest-environment node
import { describe, expect, it } from "vitest";

import { parseDashboard } from "../../shared/contract.js";
import { defaultDashboard, newTile } from "./default-dashboard";

describe("the default dashboard", () => {
  it("is a dashboard the server keeps as it is", () => {
    expect(parseDashboard(defaultDashboard())).toEqual(defaultDashboard());
  });

  it("stands every tile in exactly one cell, each row's widths summing to 1", () => {
    const { tiles, rows } = defaultDashboard();
    const cells = rows.flatMap((row) => row.cells.map((cell) => cell.id));
    expect([...cells].sort()).toEqual(tiles.map((tile) => tile.id).sort());
    rows.forEach((row) => expect(row.cells.reduce((sum, cell) => sum + cell.weight, 0)).toBeCloseTo(1, 9));
  });

  it("opens with the figures, then the charts the screen had, the Gantt last", () => {
    const { tiles, rows } = defaultDashboard();
    const byId = new Map(tiles.map((tile) => [tile.id, tile]));
    expect(rows[0]!.cells.every((cell) => byId.get(cell.id)?.type === "big")).toBe(true);
    expect(tiles.map((tile) => tile.title)).toEqual(
      expect.arrayContaining(["Status changes", "Burndown", "Closed — last 24 hours", "Closed — last 30 days", "Created vs closed", "Work in progress", "Cycle time", "Estimate accuracy", "Cost by project", "Stuck tasks", "Closed by type", "Gantt"]),
    );
    expect(byId.get(rows.at(-1)!.cells[0]!.id)?.title).toBe("Gantt");
  });

  it("reads the closed charts over the last 24 hours and the last 30 days", () => {
    const byId = new Map(defaultDashboard().tiles.map((tile) => [tile.id, tile]));
    expect(byId.get("closed-hourly")?.window).toEqual({ unit: "hour", count: 24 });
    expect(byId.get("closed-daily")?.window).toEqual({ unit: "day", count: 30 });
  });
});

describe("newTile", () => {
  it("makes a valid columns tile of the given id, the patch laid over", () => {
    const tile = newTile("t9", { title: "Mine" });
    expect(tile).toMatchObject({ id: "t9", type: "columns", title: "Mine" });
    expect(parseDashboard({ version: 1, tiles: [tile], rows: [{ id: "r", height: 200, minHeight: 100, cells: [{ id: "t9", weight: 1 }] }] })?.tiles).toEqual([tile]);
  });
});
