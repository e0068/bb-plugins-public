// @vitest-environment node
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodeTables, newTableId, parseTableId, tableNames, tableRoot } from "./db-tables.js";

const SQL_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

describe("the tables of a board database", () => {
  it("keeps the task board on its own tables, untouched by tables added beside it", () => {
    expect(tableNames(null)).toEqual({ records: "tasks", head: "board" });
    expect(tableRoot("libsql://board.turso.io", null)).toBe("libsql://board.turso.io");
  });

  it("gives every table a pair of names that are plain SQL identifiers, distinct from the task board's", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 }), (seed) => {
        let state = seed;
        const random = () => ((state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
        const id = parseTableId(newTableId(random));
        expect(id).not.toBeNull();
        const names = tableNames(id);
        expect(names.records).toMatch(SQL_IDENTIFIER);
        expect(names.head).toMatch(SQL_IDENTIFIER);
        expect([names.records, names.head]).not.toContain("tasks");
        expect([names.records, names.head]).not.toContain("board");
      }),
    );
  });

  it("puts a table's records under their own root, so a path never names the task board's record", () => {
    const id = parseTableId("ab12cd34")!;
    expect(tableRoot("libsql://board.turso.io/", id)).toBe("libsql://board.turso.io/tables/ab12cd34");
  });

  it("refuses an id that could break out of an SQL name", () => {
    expect(parseTableId("ab12cd34")).toBe("ab12cd34");
    expect(parseTableId("x; DROP TABLE tasks")).toBeNull();
    expect(parseTableId("")).toBeNull();
    expect(parseTableId("AB12CD34")).toBeNull();
  });

  it("reads the list of tables, dropping rows it cannot read", () => {
    expect(
      decodeTables([
        { id: "ab12cd34", name: "Docs" },
        { id: "bad id", name: "Broken" },
        { id: "zz99yy88", name: null },
        { id: "cd34ef56", name: "Meetings" },
      ]),
    ).toEqual([
      { id: "ab12cd34", name: "Docs", parent: null, fields: [] },
      { id: "cd34ef56", name: "Meetings", parent: null, fields: [] },
    ]);
  });

  it("reads a section's parent, and takes a parent it cannot read for none — a top section", () => {
    expect(
      decodeTables([
        { id: "ab12cd34", name: "Docs", parent: null },
        { id: "cd34ef56", name: "Specs", parent: "ab12cd34" },
        { id: "ef56ab12", name: "Odd", parent: "x; DROP" },
        { id: "aa11bb22", name: "Self", parent: "aa11bb22" },
      ]),
    ).toEqual([
      { id: "ab12cd34", name: "Docs", parent: null, fields: [] },
      { id: "cd34ef56", name: "Specs", parent: "ab12cd34", fields: [] },
      { id: "ef56ab12", name: "Odd", parent: null, fields: [] },
      { id: "aa11bb22", name: "Self", parent: null, fields: [] },
    ]);
  });

  it("reads a section's fields, and takes a list it cannot read for none", () => {
    expect(
      decodeTables([
        { id: "ab12cd34", name: "Docs", parent: null, fields: '[{"name":"size","type":"number"},{"name":"bad","type":"color"}]' },
        { id: "cd34ef56", name: "Specs", parent: null, fields: "not json" },
        { id: "ef56ab12", name: "Odd", parent: null, fields: 7 },
      ]).map((table) => table.fields),
    ).toEqual([[{ name: "size", type: "number" }], [], []]);
  });

  it("gives every row it keeps a parent that is a table id or none", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ id: fc.oneof(fc.constant("ab12cd34"), fc.string()), name: fc.oneof(fc.string(), fc.constant(null)), parent: fc.oneof(fc.constant(null), fc.string(), fc.constant("cd34ef56")) })), (rows) => {
        for (const table of decodeTables(rows)) {
          expect(table.parent === null || parseTableId(table.parent) === table.parent).toBe(true);
          expect(table.parent).not.toBe(table.id);
        }
      }),
    );
  });
});
