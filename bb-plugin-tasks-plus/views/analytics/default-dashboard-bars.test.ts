import { describe, expect, it } from "vitest";

import { defaultDashboard } from "./default-dashboard";

describe("the default bars", () => {
  it("print their values beside the bars, as they did before the labels could be turned off", () => {
    const bars = defaultDashboard().tiles.filter((tile) => tile.type === "bars" && tile.bars.length === "value");
    expect(bars.map((tile) => [tile.id, tile.display.xLabels, tile.display.yLabels])).toEqual([
      ["cycle", true, true],
      ["accuracy", true, true],
    ]);
  });
});
