import { describe, expect, it } from "vitest";

import { drawnColor } from "./icon-drawing";

// The owner's projects as the board stores them (BBPL-1011): the colour set on the project, and the icon the
// sidebar draws for it.
describe("drawnColor — the colour a project is seen in, as the sidebar draws its icon", () => {
  it("is the icon's own colour when the icon chose one: bb-plugins is red, not its steelblue field", () => {
    expect(drawnColor("filled:ph:puzzle-piece;c=indianred", "steelblue")).toBe("indianred");
    expect(drawnColor("filled:ph:book-open-text;c=goldenrod", "steelblue")).toBe("goldenrod");
  });

  it("is the tile's colour for an icon drawn on a tile", () => {
    expect(drawnColor("filled:ph:shapes;c=white;bg=slateblue", "steelblue")).toBe("slateblue");
  });

  it("is the project's colour where the icon chose none", () => {
    expect(drawnColor("ChartHistogram", "steelblue")).toBe("steelblue");
    expect(drawnColor("filled:ph:shapes", "teal")).toBe("teal");
  });

  it("is the project's colour for a Hugeicons sign on a tile of no chosen colour, whatever its line", () => {
    expect(drawnColor("filled:ChartHistogram;c=white", "teal")).toBe("teal");
  });

  it("is the project's colour for an emoji or no icon at all", () => {
    expect(drawnColor("🚀", "teal")).toBe("teal");
    expect(drawnColor(undefined, "teal")).toBe("teal");
  });
});
