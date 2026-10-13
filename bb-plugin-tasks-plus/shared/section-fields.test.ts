import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FIELDS,
  FIELD_TYPES,
  declaredField,
  fieldProblem,
  optionProblem,
  parseFields,
  sectionFields,
  tagsOf,
  tagsValue,
} from "./section-fields.js";

const record = (properties: Record<string, string>) => ({ properties });

describe("the fields of a section", () => {
  it("are tags and date for a section with no records and nothing declared", () => {
    expect(sectionFields([], [])).toEqual([
      { name: "tags", type: "tags" },
      { name: "date", type: "date" },
    ]);
  });

  it("follow the defaults with the declared ones in their order, then the records' other keys as text", () => {
    const declared = [
      { name: "size", type: "number" as const },
      { name: "done", type: "checkbox" as const },
    ];
    expect(sectionFields(declared, [record({ owner: "Ann" }), record({ date: "2026-10-13", link: "x", size: "3" })])).toEqual([
      ...DEFAULT_FIELDS,
      ...declared,
      { name: "link", type: "text" },
      { name: "owner", type: "text" },
    ]);
  });

  it("keep a default's type when a declared field repeats its name", () => {
    expect(sectionFields([{ name: "date", type: "text" }], [])).toEqual(DEFAULT_FIELDS);
  });

  it("always start with the defaults and name every record property exactly once", () => {
    fc.assert(
      fc.property(fc.array(fc.dictionary(fc.string({ minLength: 1 }), fc.string())), (all) => {
        const names = sectionFields([], all.map(record)).map((field) => field.name);
        expect(names.slice(0, DEFAULT_FIELDS.length)).toEqual(DEFAULT_FIELDS.map((field) => field.name));
        for (const name of new Set(all.flatMap((properties) => Object.keys(properties)))) {
          expect(names.filter((field) => field === name)).toHaveLength(1);
        }
      }),
    );
  });
});

describe("a stored list of fields", () => {
  it("reads back what was written", () => {
    const fields = FIELD_TYPES.map((type, index) =>
      type === "select" || type === "tags" ? { name: `f${index}`, type, options: ["a", "b"] } : { name: `f${index}`, type },
    );
    expect(parseFields(JSON.parse(JSON.stringify(fields)))).toEqual(fields);
  });

  it("leaves out entries that cannot be a field, and a second entry of a name in any case", () => {
    expect(
      parseFields([{ name: "ok", type: "text" }, { name: "OK", type: "number" }, { name: "status", type: "text" }, { name: "x", type: "color" }, "y", null]),
    ).toEqual([{ name: "ok", type: "text" }]);
  });

  it("is empty for anything but a list", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.integer(), fc.constant(null), fc.object()), (raw) => {
        expect(parseFields(raw)).toEqual([]);
      }),
    );
  });
});

describe("a new field's name", () => {
  it("is refused when blank, padded, the record's own or taken in another case", () => {
    expect(fieldProblem([], " ")).toMatch(/needs a name/);
    expect(fieldProblem([], " size")).toMatch(/space/);
    expect(fieldProblem([], "title")).toMatch(/record itself/);
    expect(fieldProblem([], "Tags")).toMatch(/already has/);
    expect(fieldProblem([{ name: "size", type: "number" }], "SIZE")).toMatch(/already has/);
  });

  it("is taken when it is new", () => {
    expect(fieldProblem([], "Size")).toBeNull();
  });
});

describe("the options of a Select or Tags field", () => {
  it("read back each once in any case, without one that could not be an option", () => {
    expect(parseFields([{ name: "stage", type: "select", options: ["Idea", "idea", " pad", "a,b", 3, "Done"] }])).toEqual([
      { name: "stage", type: "select", options: ["Idea", "Done"] },
    ]);
  });

  it("are not kept by a field of another type", () => {
    expect(parseFields([{ name: "size", type: "number", options: ["1"] }])).toEqual([{ name: "size", type: "number" }]);
  });

  it("of the Tags every section starts with come from its declaration, its type stays Tags", () => {
    expect(declaredField([{ name: "tags", type: "select", options: ["red"] }], "tags")).toEqual({ name: "tags", type: "tags", options: ["red"] });
    expect(declaredField([], "tags")).toEqual({ name: "tags", type: "tags" });
  });

  it("refuse a blank, padded, comma-holding or taken name", () => {
    expect(optionProblem([], "")).toMatch(/needs a name/);
    expect(optionProblem([], " a")).toMatch(/space/);
    expect(optionProblem([], "a,b")).toMatch(/comma/);
    expect(optionProblem(["Red"], "red")).toMatch(/already/);
    expect(optionProblem(["Red"], "Blue")).toBeNull();
  });
});

describe("a Tags value", () => {
  it("reads back the tags it was written from", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9 ]{0,8}[a-z0-9]$/)), (tags) => {
        expect(tagsOf(tagsValue(tags))).toEqual(tags);
      }),
    );
  });

  it("holds each tag once, without empty parts", () => {
    expect(tagsOf(" a, b,,a ,")).toEqual(["a", "b"]);
  });
});
