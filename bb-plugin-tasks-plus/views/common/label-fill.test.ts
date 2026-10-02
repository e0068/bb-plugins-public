import { describe, expect, it } from "vitest";

import { labelFill } from "./label-fill.js";

describe("labelFill — a tag in its own colour", () => {
  it("fills the chip with the tag's colour", () => {
    expect(labelFill("#ef4444").backgroundColor).toBe("#ef4444");
  });

  it("writes the text black or white from the colour's own lightness", () => {
    expect(labelFill("#ef4444").color).toBe("oklch(from #ef4444 clamp(0, (0.7 - l) * 1000, 1) 0 0)");
  });
});
