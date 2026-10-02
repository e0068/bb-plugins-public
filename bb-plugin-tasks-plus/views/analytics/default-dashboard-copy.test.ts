// @vitest-environment node
import { describe, expect, it } from "vitest";

import { TILE_TITLE_MAX } from "../../shared/analytics-tile.js";
import { copyTitle } from "./default-dashboard";

describe("copyTitle — a duplicate's title", () => {
  it("marks the copy and stays within the title's limit", () => {
    expect(copyTitle("Burndown")).toBe("Burndown copy");
    const long = "x".repeat(TILE_TITLE_MAX);
    expect(copyTitle(long).length).toBeLessThanOrEqual(TILE_TITLE_MAX);
    expect(copyTitle(long).endsWith(" copy")).toBe(true);
  });
});
