import { describe, expect, it } from "vitest";
import { rampColors, type SeriesPainting } from "@bb-plugins/reduced-colors";

import { chartColors, type ChartBoard } from "./chart-colors";

// BBPL-1011: the owner's board — bb-plugins red and Kasimov gold in the sidebar, both steelblue in their colour field.
const BOARD = (reducedProjects: ChartBoard["reducedProjects"]): ChartBoard => ({
  projects: [
    { id: "bb-plugins", color: "steelblue", icon: "filled:ph:puzzle-piece;c=indianred" },
    { id: "kasimov", color: "steelblue", icon: "filled:ph:book-open-text;c=goldenrod" },
    { id: "nobu", color: "steelblue", icon: "ChartHistogram" },
  ],
  reducedProjects,
});

const RAMP: SeriesPainting = { kind: "ramp", steps: (count) => rampColors("#0000ff", "#ffffff", count) };

describe("chartColors — a project is painted the colour its icon wears in the sidebar", () => {
  it("while Reduced Colors is off", () => {
    expect(["bb-plugins", "kasimov", "nobu"].map(chartColors({ kind: "palette" }, BOARD("ramp")).project)).toEqual(["indianred", "goldenrod", "steelblue"]);
  });

  it("while Reduced Colors is on and the projects keep their own colours", () => {
    expect(["bb-plugins", "kasimov", "nobu"].map(chartColors(RAMP, BOARD("own")).project)).toEqual(["indianred", "goldenrod", "steelblue"]);
  });

  it("while Reduced Colors repaints the projects, the ramp still wins", () => {
    expect(["bb-plugins", "kasimov", "nobu"].map(chartColors(RAMP, BOARD("ramp")).project)).toEqual(rampColors("#0000ff", "#ffffff", 3));
  });
});
