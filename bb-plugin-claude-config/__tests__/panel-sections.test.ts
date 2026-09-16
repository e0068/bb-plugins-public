import { describe, expect, it } from "vitest";
import {
  CREATE_LABEL,
  SECTION_SPECS,
  isSectionId,
  sectionSpec,
} from "../src/panel-sections";

describe("SECTION_SPECS", () => {
  it("gives every section a non-empty, unique title", () => {
    const titles = SECTION_SPECS.map((spec) => spec.title);
    expect(titles.every((title) => title.trim().length > 0)).toBe(true);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("marks as creatable exactly the sections that have a create path", () => {
    expect(
      SECTION_SPECS.filter((spec) => spec.create !== null).map((spec) => spec.id),
    ).toEqual(["hooks", "skills", "agents", "workflows"]);
  });

  it("labels every create kind, and names it after its own section", () => {
    for (const spec of SECTION_SPECS) {
      if (spec.create === null) continue;
      expect(spec.id.startsWith(spec.create)).toBe(true);
      expect(CREATE_LABEL[spec.create]).toMatch(/^New /);
    }
  });
});

describe("sectionSpec", () => {
  it("is total over the table's ids", () => {
    for (const spec of SECTION_SPECS) {
      expect(sectionSpec(spec.id)).toEqual(spec);
    }
  });
});

describe("isSectionId", () => {
  it("accepts a section, rejects a name that was never one", () => {
    expect(isSectionId("skills")).toBe(true);
    // A section can be renamed between builds; a stale name from storage must
    // not come back as an active section id.
    expect(isSectionId("tool-search")).toBe(false);
    expect(isSectionId(null)).toBe(false);
  });
});
