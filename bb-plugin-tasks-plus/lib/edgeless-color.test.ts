import { describe, expect, it } from "vitest";
import { isEdgeless } from "./edgeless-color";

describe("isEdgeless — a colour that vanishes into one of the themes' backgrounds", () => {
  it("knows white and black however they are spelled", () => {
    for (const color of ["white", "White", " WHITE ", "#fff", "#FFFFFF", "black", "#000", "#000000"]) expect(isEdgeless(color)).toBe(true);
  });

  it("leaves every other colour alone", () => {
    for (const color of ["indianred", "slategray", "#3b82f6", "#fffffe", "var(--muted-foreground)", ""]) expect(isEdgeless(color)).toBe(false);
  });
});
