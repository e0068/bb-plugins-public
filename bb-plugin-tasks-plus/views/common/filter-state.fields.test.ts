import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DATE_FIELDS, NUMBER_FIELDS, QUERY_FIELDS, TEXT_FIELDS, VALUE_FILTER_FIELDS } from "../../shared/enums.js";
import { EMPTY_FILTERS, activeFilterFields, hasActiveFilters, withFieldFilter } from "./filter-state.js";
import { sanitizeListPreference } from "./list-preference.js";

const valueFieldArb = fc.constantFrom(...VALUE_FILTER_FIELDS);
const textFieldArb = fc.constantFrom(...TEXT_FIELDS);
const dateFieldArb = fc.constantFrom(...DATE_FIELDS);
const numberFieldArb = fc.constantFrom(...NUMBER_FIELDS);

describe("filters on every field", () => {
  it("an empty filter state filters nothing and names no field", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(activeFilterFields(EMPTY_FILTERS)).toEqual([]);
  });

  it("a field given a filter is active, named once, and clearing it restores the state", () => {
    const filtered = fc.oneof(
      fc.tuple(valueFieldArb, fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 3 })).map(
        ([field, values]) => withFieldFilter(EMPTY_FILTERS, { kind: "values", field, values }),
      ),
      fc.tuple(textFieldArb, fc.string({ minLength: 1 }).filter((text) => text.trim() !== "")).map(([field, text]) =>
        withFieldFilter(EMPTY_FILTERS, { kind: "text", field, text }),
      ),
      fc.tuple(dateFieldArb, fc.boolean()).map(([field, empty]) =>
        withFieldFilter(EMPTY_FILTERS, { kind: "date", field, range: { from: "2026-10-01", to: null, empty } }),
      ),
      fc.tuple(numberFieldArb, fc.integer({ min: 0, max: 9 })).map(([field, to]) =>
        withFieldFilter(EMPTY_FILTERS, { kind: "number", field, range: { from: null, to, empty: false } }),
      ),
    );
    fc.assert(
      fc.property(filtered, (filters) => {
        expect(hasActiveFilters(filters)).toBe(true);
        const fields = activeFilterFields(filters);
        expect(fields).toHaveLength(1);
        expect(QUERY_FIELDS).toContain(fields[0]);
        expect(withFieldFilter(filters, { kind: "clear", field: fields[0]! })).toEqual(EMPTY_FILTERS);
      }),
    );
  });

  it("names the first seven by their fields too", () => {
    expect(activeFilterFields({ ...EMPTY_FILTERS, statuses: ["todo"], labelNames: ["ui"], parents: ["P:a"] })).toEqual([
      "parent",
      "status",
      "labels",
    ]);
    expect(withFieldFilter({ ...EMPTY_FILTERS, statuses: ["todo"] }, { kind: "clear", field: "status" })).toEqual(EMPTY_FILTERS);
  });

  it("a blank text, an empty pick or an open range sets no filter", () => {
    expect(withFieldFilter(EMPTY_FILTERS, { kind: "text", field: "title", text: "  " })).toEqual(EMPTY_FILTERS);
    expect(withFieldFilter(EMPTY_FILTERS, { kind: "values", field: "epic", values: [] })).toEqual(EMPTY_FILTERS);
    expect(
      withFieldFilter(EMPTY_FILTERS, { kind: "date", field: "dueDate", range: { from: null, to: null, empty: false } }),
    ).toEqual(EMPTY_FILTERS);
  });
});

describe("stored filters on every field", () => {
  it("read back as written", () => {
    const filters = {
      ...EMPTY_FILTERS,
      values: { epic: ["P:e"], active: ["active"] },
      texts: { title: "login" },
      dates: { dueDate: { from: "2026-10-01", to: "2026-10-15", empty: true } },
      numbers: { budget: { from: 5, to: null, empty: false } },
    };
    expect(sanitizeListPreference({ filters, sort: { column: "title", direction: "desc" } })).toEqual({
      filters,
      sort: { column: "title", direction: "desc" },
    });
  });

  it("drop what is malformed and keep the rest", () => {
    const read = sanitizeListPreference({
      filters: {
        values: { epic: ["P:e", 3], nope: ["x"], active: "active" },
        texts: { title: 7, key: "TSK" },
        dates: { dueDate: { from: "tomorrow", to: null, empty: false }, startDate: { from: "2026-10-01", to: null, empty: false } },
        numbers: { cost: { from: "5", to: null, empty: false }, budget: { from: null, to: 9, empty: false } },
      },
      sort: { column: "nope", direction: "asc" },
    });
    expect(read.filters.values).toEqual({ epic: ["P:e"] });
    expect(read.filters.texts).toEqual({ key: "TSK" });
    expect(read.filters.dates).toEqual({ startDate: { from: "2026-10-01", to: null, empty: false } });
    expect(read.filters.numbers).toEqual({ budget: { from: null, to: 9, empty: false } });
    expect(read.sort).toBe("manual");
  });
});
