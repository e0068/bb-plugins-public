import { describe, expect, it } from "vitest";

import type { TileAnswer } from "../../shared/contract.js";
import { segmentKeys } from "./tile-charts";

const answer = {
  columns: [
    { key: "0", label: "" },
    { key: "1", label: "" },
  ],
  series: [
    { key: "todo", label: "todo" },
    { key: "done", label: "done" },
  ],
  values: [
    [2, 1],
    [1, 1],
  ],
  cells: [
    [["TSK-1", "TSK-2"], ["TSK-3"]],
    [["TSK-2"], ["TSK-4"]],
  ],
} as unknown as TileAnswer;

describe("segmentKeys", () => {
  it("lists every task of the chart once while nothing is picked", () => {
    expect(segmentKeys(answer, null)).toEqual(["TSK-1", "TSK-2", "TSK-3", "TSK-4"]);
  });

  it("lists a whole column when no series is named — a ring's slice", () => {
    expect(segmentKeys(answer, { column: 1, seriesId: null })).toEqual(["TSK-2", "TSK-4"]);
  });

  it("lists one segment's tasks", () => {
    expect(segmentKeys(answer, { column: 0, seriesId: "done" })).toEqual(["TSK-3"]);
  });

  it("lists nothing for a segment the answer no longer has", () => {
    expect(segmentKeys(answer, { column: 5, seriesId: "todo" })).toEqual([]);
    expect(segmentKeys(answer, { column: 0, seriesId: "gone" })).toEqual([]);
  });
});
