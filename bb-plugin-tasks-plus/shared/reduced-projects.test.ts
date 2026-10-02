import { describe, expect, it } from "vitest";
import { DEFAULT_REDUCED_PROJECTS, parseReducedProjects } from "./reduced-projects";

describe("parseReducedProjects — whether Reduced Colors repaints the projects", () => {
  it("keeps either stored answer", () => {
    expect(parseReducedProjects("ramp")).toBe("ramp");
    expect(parseReducedProjects("own")).toBe("own");
  });

  it("repaints by default, as the analytics did before the choice existed", () => {
    expect(DEFAULT_REDUCED_PROJECTS).toBe("ramp");
    for (const raw of [undefined, null, "", "OWN", 1, true, {}, ["own"]]) expect(parseReducedProjects(raw)).toBe("ramp");
  });
});
