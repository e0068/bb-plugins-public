import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { SectionField } from "../../shared/section-fields.js";
import {
  allSectionColumns,
  DEFAULT_SECTION_LAYOUT,
  movedSectionLayout,
  readSectionLayout,
  sortedRecords,
  visibleSectionColumns,
  withWidth,
  type SectionLayout,
} from "./section-layout.js";

const FIELDS: SectionField[] = [
  { name: "tags", type: "text" },
  { name: "size", type: "number" },
];
const layout = (patch: Partial<SectionLayout>): SectionLayout => ({ ...DEFAULT_SECTION_LAYOUT, ...patch });
const record = (title: string, properties: Record<string, string> = {}, description = "", labelIds: string[] = []) => ({
  title,
  description,
  labelIds,
  createdAt: "2026-10-13T10:00:00.000Z",
  updatedAt: "2026-10-13T10:00:00.000Z",
  properties,
});

describe("a section's columns", () => {
  it("are the title, the two dates and the fields, the title pinned first", () => {
    expect(visibleSectionColumns(FIELDS, DEFAULT_SECTION_LAYOUT)).toEqual(["title", "createdAt", "updatedAt", "field:tags", "field:size"]);
  });

  it("leave out the hidden ones but never the title, and lead with the pinned", () => {
    expect(visibleSectionColumns(FIELDS, layout({ hidden: ["title", "createdAt"], pinned: ["title", "field:size"] }))).toEqual([
      "title",
      "field:size",
      "description",
      "updatedAt",
      "field:tags",
    ]);
  });

  it("hold the record's text right after the title once the Display panel shows it", () => {
    expect(allSectionColumns(FIELDS, DEFAULT_SECTION_LAYOUT).slice(0, 2)).toEqual(["title", "description"]);
    expect(readSectionLayout({}).hidden).toEqual(["description"]);
  });

  it("stand where a drag left them, and a field added later comes after them", () => {
    const moved = movedSectionLayout(FIELDS, DEFAULT_SECTION_LAYOUT, "field:size", 1);
    expect(visibleSectionColumns(FIELDS, moved)).toEqual(["title", "field:size", "createdAt", "updatedAt", "field:tags"]);
    expect(allSectionColumns([...FIELDS, { name: "done", type: "checkbox" }], moved).at(-1)).toBe("field:done");
  });

  it("keep a hidden column through a move, so it comes back", () => {
    const moved = movedSectionLayout(FIELDS, layout({ hidden: ["field:tags"] }), "updatedAt", 1);
    expect(allSectionColumns(FIELDS, moved)).toContain("field:tags");
  });

  it("are each drawn once, whatever the layout says", () => {
    const column = fc.constantFrom("title", "description", "createdAt", "updatedAt", "field:tags", "field:size", "field:gone");
    fc.assert(
      fc.property(fc.array(column), fc.array(column), fc.array(column), (order, hidden, pinned) => {
        const drawn = visibleSectionColumns(FIELDS, layout({ order, hidden, pinned }));
        expect(new Set(drawn).size).toBe(drawn.length);
        expect(drawn).toContain("title");
        expect(drawn).not.toContain("field:gone");
      }),
    );
  });

  it("hold a dragged width inside the allowed range", () => {
    expect(withWidth(DEFAULT_SECTION_LAYOUT, "field:tags", 5).widths["field:tags"]).toBe(64);
    expect(withWidth(withWidth(DEFAULT_SECTION_LAYOUT, "field:tags", 200), "field:tags", null).widths).toEqual({});
  });
});

describe("a section's records, sorted", () => {
  it("by a number field read as numbers, the empty and the non-numbers last both ways", () => {
    const records = [record("ten", { size: "10" }), record("none"), record("nine", { size: "9" }), record("odd", { size: "x" })];
    const titles = (direction: "asc" | "desc") => sortedRecords(records, { column: "field:size", direction }, FIELDS).map((entry) => entry.title);
    expect(titles("asc").slice(0, 2)).toEqual(["nine", "ten"]);
    expect(titles("desc").slice(0, 2)).toEqual(["ten", "nine"]);
    expect(titles("desc").slice(2).sort()).toEqual(["none", "odd"]);
  });

  it("by a checkbox with the checked first going up", () => {
    const fields: SectionField[] = [{ name: "done", type: "checkbox" }];
    const sorted = sortedRecords([record("no", { done: "false" }), record("yes", { done: "true" })], { column: "field:done", direction: "asc" }, fields);
    expect(sorted.map((entry) => entry.title)).toEqual(["yes", "no"]);
  });

  it("by the record's text, its first paragraph", () => {
    const records = [record("b", {}, "Zebra\n\nAardvark"), record("a", {}, "Mole")];
    expect(sortedRecords(records, { column: "description", direction: "asc" }, FIELDS).map((entry) => entry.title)).toEqual(["a", "b"]);
  });

  it("by Tags, the record's labels", () => {
    const records = [record("b", { tags: "aaa" }, "", ["zeta"]), record("a", {}, "", ["alpha"])];
    expect(sortedRecords(records, { column: "field:tags", direction: "asc" }, FIELDS).map((entry) => entry.title)).toEqual(["a", "b"]);
  });

  it("as they came when there is no sort", () => {
    const records = [record("b"), record("a")];
    expect(sortedRecords(records, null, FIELDS)).toEqual(records);
  });
});

describe("a stored layout", () => {
  it("reads back what was written", () => {
    const written = layout({ order: ["field:size"], hidden: ["updatedAt"], pinned: ["title"], widths: { "field:size": 200 }, sort: { column: "field:size", direction: "desc" }, formats: { createdAt: "relative" } });
    expect(readSectionLayout(JSON.parse(JSON.stringify(written)))).toEqual(written);
  });

  it("drops what cannot be a column, a sort or a format", () => {
    expect(readSectionLayout({ order: ["status", 3], sort: { column: "status", direction: "up" }, widths: { title: "wide" }, formats: { title: "weekday" } })).toEqual(
      DEFAULT_SECTION_LAYOUT,
    );
    expect(readSectionLayout("junk")).toEqual(DEFAULT_SECTION_LAYOUT);
  });
});
