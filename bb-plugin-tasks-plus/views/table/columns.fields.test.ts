import { describe, expect, it } from "vitest";
import { QUERY_FIELDS, WIDGET_FIELDS } from "../../shared/enums.js";
import { sortableColumn } from "./columns.js";

describe("the table's sort", () => {
  it("offers every field but the card's widgets", () => {
    for (const field of QUERY_FIELDS) expect(sortableColumn(field)).toBe(true);
    for (const widget of WIDGET_FIELDS) expect(sortableColumn(widget)).toBe(false);
  });
});
