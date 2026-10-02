// @vitest-environment node
import { describe, expect, it } from "vitest";
import { migrateSavedView } from "./saved-view-migrate.js";

const EPIC_ID = "01J0000000000000000000000B:flow-epic";
const FILTERS = { statuses: [], priorities: [], types: [], estimates: [], labelNames: [], assignees: [], parents: [] };
const COLUMN = { order: ["todo"], hidden: [], widths: {} };

const view = (over: Record<string, unknown>) => ({
  id: "01J0000000000000000000000A",
  version: 2 as const,
  name: "Flow work",
  projectId: "01J0000000000000000000000B",
  listScope: null,
  surface: "board",
  filters: FILTERS,
  sort: "manual" as const,
  fields: { fields: [{ field: "epic", visible: true }, { field: "title", visible: true }], showEmpty: false, showDescription: false },
  board: { groupBy: "status", columns: {}, hideEmpty: false },
  table: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  ...over,
});

describe("migrateSavedView and the retired Epic field", () => {
  it("keeps a view filtered by epic, dropping that filter and keeping the others", () => {
    const migrated = migrateSavedView(view({ filters: { ...FILTERS, values: { epic: [EPIC_ID], flow: ["Code"] } } }));
    expect(migrated?.filters.values).toEqual({ flow: ["Code"] });
    expect(migrated?.fields.fields.map((entry) => entry.field)).toEqual(["title"]);
  });

  it("reads a view sorted by epic as the manual order", () => {
    expect(migrateSavedView(view({ sort: { column: "epic", direction: "asc" } }))?.sort).toBe("manual");
  });

  it("groups a board grouped by epic by status, without the epic columns' settings", () => {
    const migrated = migrateSavedView(view({ board: { groupBy: "epic", columns: { epic: COLUMN, status: COLUMN }, hideEmpty: true } }));
    expect(migrated?.board).toEqual({ groupBy: "status", columns: { status: COLUMN }, hideEmpty: true });
  });

  it("takes epic out of a table's sort, grouping, widths and pins", () => {
    const migrated = migrateSavedView(
      view({
        surface: "table",
        board: null,
        table: { sort: { column: "epic", direction: "desc" }, groupBy: "epic", widths: { epic: 120, title: 300 }, pinned: ["epic", "title"], collapsedGroups: [] },
      }),
    );
    expect(migrated?.table).toEqual({ sort: null, groupBy: "status", widths: { title: 300 }, pinned: ["title"], collapsedGroups: [] });
  });
});
