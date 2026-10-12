import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_ICON, ICON_CATALOG } from "./index";

describe("the icon catalog shared by Flow and Tasks+", () => {
  it("holds the icons Flow's stages already name, Folder01 among them", () => {
    expect(ICON_CATALOG.size).toBeGreaterThan(200);
    for (const name of ["Folder01", "Rocket", "Puzzle", "Bug01", "CodeFolder", "WorkflowCircle01"]) {
      expect(ICON_CATALOG.has(name), name).toBe(true);
    }
  });

  it("gives every name an icon to draw", () => {
    for (const [name, icon] of ICON_CATALOG) {
      expect(Array.isArray(icon) && icon.length > 0, name).toBe(true);
    }
  });

  it("names a project without a chosen icon by an icon it holds", () => {
    expect(DEFAULT_PROJECT_ICON).toBe("Folder01");
    expect(ICON_CATALOG.has(DEFAULT_PROJECT_ICON)).toBe(true);
  });
});
