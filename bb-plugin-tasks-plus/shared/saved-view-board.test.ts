import { describe, expect, it } from "vitest";
import { boardGroupingSchema, savedViewSchema, tasksRpcContract } from "./contract.js";

const VALID_ULID = "01J0000000000000000000000A";

const emptyFilters = {
  statuses: [],
  priorities: [],
  types: [],
  estimates: [],
  labelNames: [],
  assignees: [],
  parents: [],
};

const listView = {
  id: VALID_ULID,
  version: 2,
  name: "My view",
  projectId: null,
  listScope: null,
  filters: emptyFilters,
  sort: "manual",
  fields: { fields: [], showEmpty: false, showDescription: false },
  createdAt: "2026-07-01T00:00:00.000Z",
};

const grouping = {
  groupBy: "priority",
  columns: { priority: { order: ["high", "urgent"], hidden: ["none"], widths: { high: 320 } } },
  hideEmpty: false,
};

const boardView = {
  ...listView,
  projectId: VALID_ULID,
  surface: "board",
  board: grouping,
};

describe("a saved view names the surface it opens", () => {

  it("accepts a board view bound to a project with its grouping", () => {
    const parsed = savedViewSchema.parse(boardView);
    expect(parsed.surface).toBe("board");
    expect(parsed.board?.groupBy).toBe("priority");
  });

  it("rejects a board view without its grouping", () => {
    expect(savedViewSchema.safeParse({ ...boardView, board: null }).success).toBe(false);
  });

  it("rejects a list view that carries a board grouping", () => {
    expect(savedViewSchema.safeParse({ ...listView, board: grouping }).success).toBe(false);
  });

  it("creates a board view through createSavedView", () => {
    const { id: _id, version: _version, createdAt: _createdAt, ...body } = boardView;
    expect(tasksRpcContract.createSavedView.input.safeParse(body).success).toBe(true);
  });
});

describe("boardGroupingSchema", () => {
  it("accepts settings for only some of the properties", () => {
    expect(boardGroupingSchema.safeParse(grouping).success).toBe(true);
  });

  it("accepts no grouping at all", () => {
    expect(
      boardGroupingSchema.safeParse({ groupBy: "none", columns: {}, hideEmpty: false }).success,
    ).toBe(true);
  });

  it("keeps column widths between 200 and 480 px", () => {
    const withWidth = (width: number) => ({
      ...grouping,
      columns: { priority: { order: [], hidden: [], widths: { high: width } } },
    });
    expect(boardGroupingSchema.safeParse(withWidth(200)).success).toBe(true);
    expect(boardGroupingSchema.safeParse(withWidth(480)).success).toBe(true);
    expect(boardGroupingSchema.safeParse(withWidth(199)).success).toBe(false);
    expect(boardGroupingSchema.safeParse(withWidth(481)).success).toBe(false);
  });

  it("rejects an unknown property to group by", () => {
    expect(boardGroupingSchema.safeParse({ ...grouping, groupBy: "color" }).success).toBe(false);
  });
});
