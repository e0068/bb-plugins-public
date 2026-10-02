import { describe, expect, it } from "vitest";

import { CONTENTS_SHARE, TILE_TYPES, usesSetting } from "./analytics-tile.js";
import { tileSchema } from "./contract.js";

const tile = (display: Record<string, unknown>) => ({
  id: "t",
  type: "columns",
  title: "T",
  window: "page",
  x: "time",
  y: { metric: "count", field: null },
  breakdown: null,
  switch: null,
  conditions: [],
  sort: null,
  limit: 20,
  bars: { length: "value", gantt: "fact" },
  figures: [],
  display: { legend: "bottom", xLabels: true, yLabels: false, grid: { x: null, y: null }, trend: false, ...display },
});

describe("segment contents", () => {
  it("are read by columns, bars and the ring only — the charts made of segments", () => {
    expect(TILE_TYPES.filter((type) => usesSetting(type, "contents"))).toEqual(["columns", "bars", "ring"]);
  });

  it("start the chart at a share inside its bounds", () => {
    expect(CONTENTS_SHARE.min).toBeLessThan(CONTENTS_SHARE.start);
    expect(CONTENTS_SHARE.start).toBeLessThan(CONTENTS_SHARE.max);
  });

  it("are off on a tile saved without them, and keep the chart's share when on", () => {
    expect(tileSchema.safeParse(tile({})).success).toBe(true);
    expect(tileSchema.parse(tile({ contents: 0.6 })).display.contents).toBe(0.6);
  });

  it("refuse a share past the bounds", () => {
    expect(tileSchema.safeParse(tile({ contents: CONTENTS_SHARE.max + 0.1 })).success).toBe(false);
    expect(tileSchema.safeParse(tile({ contents: CONTENTS_SHARE.min - 0.1 })).success).toBe(false);
  });
});
