import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Task } from "../../shared/contract.js";
import { surfaceFieldOrder, type RowField } from "../common/row-field-preference.js";
import {
  TABLE_COLUMNS,
  clampColumnWidth,
  compareByColumn,
  defaultColumnWidth,
  moveColumn,
  orderedColumns,
  pinOffsets,
  sortableColumn,
  type ColumnSort,
  type SortContext,
  type TableColumn,
} from "./columns.js";

function task(overrides: Partial<Task> = {}): Task {
  const n = overrides.number ?? 1;
  return {
    id: `01HZZZZZZZZZZZZZZZZZZZZZ${String(n).padStart(2, "0")}`,
    projectId: "P1",
    number: n,
    key: `TSK-${n}`,
    title: `Task ${n}`,
    description: "",
    status: "todo",
    priority: "none",
    type: null,
    estimate: null,
    plannedMinutes: null,
    actualMinutes: null,
    budget: null,
    budgetLimit: null,
    cost: null,
    dueDate: null,
    startDate: null,
    parentTaskId: null,
    position: n,
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    labelIds: [],
    source: null,
    ...overrides,
  } as Task;
}

const CONTEXT: SortContext = { projectNames: new Map([["P1", "Alpha"], ["P2", "beta"]]), taskKeys: new Map() };

const columnArb = fc.constantFrom(...(surfaceFieldOrder("list") as RowField[]));
const fieldsArb = fc
  .shuffledSubarray([...surfaceFieldOrder("list")], { minLength: 0 })
  .chain((order) => fc.tuple(fc.constant(order), fc.array(fc.boolean(), { minLength: order.length, maxLength: order.length })))
  .map(([order, visible]) => order.map((field, i) => ({ field, visible: visible[i]! })));

describe("column order", () => {
  it("offers the list's fields, in their canonical order", () => {
    expect(TABLE_COLUMNS).toEqual(surfaceFieldOrder("list"));
  });

  it("pinned columns lead in their own order and the title is always shown", () => {
    fc.assert(
      fc.property(fieldsArb, fc.array(columnArb, { maxLength: 5 }), (fields, pinnedRaw) => {
        const pinned = [...new Set(pinnedRaw)];
        const columns = orderedColumns(fields, pinned);
        const visible = new Set(fields.filter((entry) => entry.visible).map((entry) => entry.field));
        visible.add("title");
        expect(new Set(columns)).toEqual(visible);
        expect(columns.length).toBe(visible.size);
        const pinnedShown = columns.filter((column) => pinned.includes(column));
        expect(columns.slice(0, pinnedShown.length)).toEqual(pinnedShown);
        const unpinned = columns.slice(pinnedShown.length);
        const fieldOrder = fields.map((entry) => entry.field);
        const withoutTitle = unpinned.filter((column) => fieldOrder.includes(column));
        expect(withoutTitle).toEqual([...withoutTitle].sort((a, b) => fieldOrder.indexOf(a) - fieldOrder.indexOf(b)));
      }),
    );
  });

  it("keeps the title when the fields hide it", () => {
    expect(orderedColumns([{ field: "title", visible: false }, { field: "key", visible: true }], [])).toContain("title");
  });
});

describe("widths and pin offsets", () => {
  it("a clamped width stays within bounds and is idempotent", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e6, max: 1e6, noNaN: true }), (width) => {
        const clamped = clampColumnWidth(width);
        expect(Number.isInteger(clamped)).toBe(true);
        expect(clamped).toBeGreaterThanOrEqual(64);
        expect(clamped).toBeLessThanOrEqual(640);
        expect(clampColumnWidth(clamped)).toBe(clamped);
      }),
    );
  });

  it("the title and description start wider than the rest", () => {
    expect(defaultColumnWidth("title")).toBe(360);
    expect(defaultColumnWidth("description")).toBe(280);
    expect(defaultColumnWidth("key")).toBe(140);
  });

  it("pin offsets are running sums of the widths on their left", () => {
    const columns: TableColumn[] = ["title", "key", "status", "priority"];
    const { offsets, edge } = pinOffsets(columns, ["title", "key"], { title: 300 });
    expect(offsets).toEqual({ title: 0, key: 300 });
    expect(edge).toBe("key");
    expect(pinOffsets(columns, [], {})).toEqual({ offsets: {}, edge: null });
  });
});

describe("moving a column", () => {
  const displayed = fc
    .shuffledSubarray([...surfaceFieldOrder("list")], { minLength: 2, maxLength: 10 })
    .chain((columns) =>
      fc.record({
        columns: fc.constant(columns),
        pinnedCount: fc.integer({ min: 0, max: columns.length }),
        from: fc.constantFrom(...columns),
        to: fc.integer({ min: 0, max: columns.length - 1 }),
      }),
    );

  it("a move is a permutation", () => {
    fc.assert(
      fc.property(displayed, ({ columns, pinnedCount, from, to }) => {
        const pinned = columns.slice(0, pinnedCount);
        const moved = moveColumn(columns, pinned, from, to);
        expect([...moved.columns].sort()).toEqual([...columns].sort());
        expect(moved.columns.indexOf(from)).toBe(to);
        expect(new Set(moved.pinned).size).toBe(moved.pinned.length);
      }),
    );
  });

  it("dropping into the pinned zone pins, dropping out unpins", () => {
    const columns: TableColumn[] = ["title", "key", "status", "priority"];
    expect(moveColumn(columns, ["title", "key"], "priority", 1)).toEqual({
      columns: ["title", "priority", "key", "status"],
      pinned: ["title", "priority", "key"],
    });
    expect(moveColumn(columns, ["title", "key"], "key", 3)).toEqual({
      columns: ["title", "status", "priority", "key"],
      pinned: ["title"],
    });
  });
});

describe("sorting by a column", () => {
  const filled = (column: TableColumn, value: unknown) => task({ [column]: value } as Partial<Task>);

  it("descending is ascending reversed on filled values", () => {
    const dates = fc.array(fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01"), noInvalidDate: true }), { minLength: 2, maxLength: 8 });
    fc.assert(
      fc.property(dates, (values) => {
        const tasks = values.map((date, i) => task({ number: i + 1, dueDate: date.toISOString().slice(0, 10) }));
        const asc = [...tasks].sort(compareByColumn({ column: "dueDate", direction: "asc" }, CONTEXT)).map((t) => t.dueDate);
        const desc = [...tasks].sort(compareByColumn({ column: "dueDate", direction: "desc" }, CONTEXT)).map((t) => t.dueDate);
        expect(desc).toEqual([...asc].reverse());
        expect(asc).toEqual([...asc].sort());
      }),
    );
  });

  it("empty values sort last both ways", () => {
    const tasks = [filled("budget", null), filled("budget", 5), filled("budget", 1)].map((t, i) => ({ ...t, number: i + 1, id: `id${i}` }));
    for (const direction of ["asc", "desc"] as const) {
      const sorted = [...tasks].sort(compareByColumn({ column: "budget", direction }, CONTEXT));
      expect(sorted.at(-1)!.budget).toBeNull();
    }
    const titles = [task({ title: "banana" }), task({ title: "Apple" }), task({ title: "cherry" })];
    expect([...titles].sort(compareByColumn({ column: "title", direction: "asc" }, CONTEXT)).map((t) => t.title)).toEqual(["Apple", "banana", "cherry"]);
  });

  it("status, priority and estimate follow their own order", () => {
    const sortBy = (sort: ColumnSort, tasks: Task[]) => [...tasks].sort(compareByColumn(sort, CONTEXT));
    expect(
      sortBy({ column: "status", direction: "asc" }, [task({ status: "done" }), task({ status: "backlog" }), task({ status: "in_review" })]).map((t) => t.status),
    ).toEqual(["backlog", "in_review", "done"]);
    expect(
      sortBy({ column: "priority", direction: "asc" }, [task({ priority: "low" }), task({ priority: "urgent" }), task({ priority: "medium" })]).map((t) => t.priority),
    ).toEqual(["urgent", "medium", "low"]);
    expect(
      sortBy({ column: "estimate", direction: "asc" }, [task({ estimate: "xl" }), task({ estimate: "xs" }), task({ estimate: "m" })]).map((t) => t.estimate),
    ).toEqual(["xs", "m", "xl"]);
    expect(
      sortBy({ column: "project", direction: "asc" }, [task({ projectId: "P2" }), task({ projectId: "P1" })]).map((t) => t.projectId),
    ).toEqual(["P1", "P2"]);
  });
});
