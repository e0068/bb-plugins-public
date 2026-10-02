import { describe, expect, it } from "vitest";
import { COLOR_PALETTE } from "./shared";

describe("COLOR_PALETTE — the colours a project or label can take", () => {
  it("ends with White and Black after the ten hues", () => {
    expect(COLOR_PALETTE.map((swatch) => swatch.label)).toEqual(["Indigo", "Blue", "Teal", "Green", "Yellow", "Orange", "Red", "Pink", "Purple", "Gray", "White", "Black"]);
    expect(COLOR_PALETTE.slice(-2).map((swatch) => swatch.value)).toEqual(["white", "black"]);
  });
});
