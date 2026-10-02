// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { TileAnswer } from "../../shared/contract.js";
import { newTile } from "./default-dashboard";
import { columnName, TileChart } from "./tile-charts";

afterEach(cleanup);

const answer = (values: number[][]): TileAnswer => ({
  columns: values.map((_, index) => ({ key: String(index), label: "" })),
  series: [{ key: "value", label: "Tasks" }],
  values,
  cells: values.map(() => [[]]),
  titles: {},
  switchValues: [],
  total: 1,
  rows: [],
  figures: {},
  projects: [],
  logStartMs: null,
});

describe("columnName — hours and minutes over more than a day", () => {
  it("names the day too, so two columns of the same hour read apart", () => {
    const start = new Date(2026, 9, 1, 14).getTime();
    const edges = Array.from({ length: 49 }, (_, index) => start + index * 3_600_000);
    const tile = newTile("t", { x: "time", window: { unit: "hour", count: 48 } });
    const time = answer(Array.from({ length: 48 }, () => [1]));
    expect(columnName(tile, time, edges, "hour", 0)).not.toBe(columnName(tile, time, edges, "hour", 24));
    const short = edges.slice(0, 7);
    expect(columnName(tile, answer(Array.from({ length: 6 }, () => [1])), short, "hour", 0)).not.toMatch(/Oct|окт/);
  });
});
