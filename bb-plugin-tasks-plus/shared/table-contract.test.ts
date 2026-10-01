import { describe, expect, it } from "vitest";
import * as enums from "./enums.js";
import * as contract from "./contract.js";

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

const baseView = {
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

const settings = {
  sort: { column: "dueDate", direction: "desc" },
  groupBy: "priority",
  widths: { title: 420, key: 90 },
  pinned: ["title", "key"],
  collapsedGroups: ["done"],
};

const grouping = { groupBy: "status", columns: {}, hideEmpty: false };

// Read through a record so a schema that does not exist yet fails the
// assertion rather than the import.
const schemas = contract as unknown as Record<string, { safeParse: (value: unknown) => { success: boolean; data?: unknown } } | undefined>;
const tableSettings = (value: unknown) => {
  const schema = schemas.tableSettingsSchema;
  expect(schema, "tableSettingsSchema is exported").toBeDefined();
  return schema!.safeParse(value);
};
const view = (value: unknown) => contract.savedViewSchema.safeParse(value);

describe("the two layouts in the shared enums", () => {
  it("enums name the two layouts and both sort directions", () => {
    const e = enums as unknown as Record<string, unknown>;
    expect(e.TASK_LAYOUTS).toEqual(["table", "board"]);
    expect(e.TABLE_SORT_DIRECTIONS).toEqual(["asc", "desc"]);
    expect(e.TABLE_COLUMN_WIDTH).toEqual({ min: 64, max: 640 });
  });
});

describe("table settings", () => {
  it("accept a full set of settings", () => {
    expect(tableSettings(settings).success).toBe(true);
    expect(tableSettings({ ...settings, sort: null, groupBy: "none", widths: {}, pinned: [], collapsedGroups: [] }).success).toBe(true);
  });

  it("table settings reject an unknown column, a width out of bounds and a stray key", () => {
    expect(tableSettings({ ...settings, sort: { column: "nope", direction: "asc" } }).success).toBe(false);
    expect(tableSettings({ ...settings, sort: { column: "title", direction: "up" } }).success).toBe(false);
    expect(tableSettings({ ...settings, pinned: ["nope"] }).success).toBe(false);
    expect(tableSettings({ ...settings, widths: { title: 63 } }).success).toBe(false);
    expect(tableSettings({ ...settings, widths: { title: 641 } }).success).toBe(false);
    expect(tableSettings({ ...settings, groupBy: "flavour" }).success).toBe(false);
    expect(tableSettings({ ...settings, extra: true }).success).toBe(false);
  });
});

describe("a saved view opens a table or a board", () => {
  it("a view saved as a list reads back as a table", () => {
    const listed = view({ ...baseView, surface: "list" });
    expect(listed.success).toBe(true);
    expect((listed.data as { surface: string }).surface).toBe("table");
    const bare = view(baseView);
    expect(bare.success).toBe(true);
    expect((bare.data as { surface: string; table: unknown }).surface).toBe("table");
    expect((bare.data as { table: unknown }).table).toBeNull();
  });

  it("a table view keeps its table settings", () => {
    const parsed = view({ ...baseView, surface: "table", table: settings });
    expect(parsed.success).toBe(true);
    expect((parsed.data as { table: unknown }).table).toEqual(settings);
  });

  it("a board view may open a cross-project screen", () => {
    expect(view({ ...baseView, surface: "board", board: grouping }).success).toBe(true);
    expect(view({ ...baseView, listScope: "active", surface: "board", board: grouping }).success).toBe(true);
    expect(view({ ...baseView, projectId: VALID_ULID, surface: "board", board: grouping }).success).toBe(true);
  });

  it("a view never names a project and a cross-project screen at once", () => {
    expect(view({ ...baseView, projectId: VALID_ULID, listScope: "waiting", surface: "board", board: grouping }).success).toBe(false);
    expect(view({ ...baseView, projectId: VALID_ULID, listScope: "waiting", surface: "table" }).success).toBe(false);
  });

  it("a table carries no board grouping, a board always does", () => {
    expect(view({ ...baseView, surface: "table", board: grouping }).success).toBe(false);
    expect(view({ ...baseView, surface: "board", board: null }).success).toBe(false);
  });
});
