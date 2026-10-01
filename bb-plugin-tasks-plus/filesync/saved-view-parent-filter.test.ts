// @vitest-environment node
import { describe, expect, it } from "vitest";
import { migrateSavedView } from "./saved-view-migrate.js";

const EPIC_ID = "01J0000000000000000000000B:flow-epic";
const NO_PLACEMENT = { statuses: ["todo"], priorities: [], types: [], estimates: [], labelNames: [], assignees: ["Claude"] };

const view = (filters: Record<string, unknown>) => ({
  id: "01J0000000000000000000000A",
  version: 2 as const,
  name: "Flow work",
  projectId: "01J0000000000000000000000B",
  listScope: null,
  filters,
  sort: "manual" as const,
  fields: { fields: [], showEmpty: false, showDescription: false },
  createdAt: "2026-07-01T00:00:00.000Z",
});

describe("migrateSavedView and the epic filter the parent filter took over", () => {
  it("keeps a view saved with an epic filter, dropping the filter and nothing else", () => {
    const migrated = migrateSavedView(view({ ...NO_PLACEMENT, epics: ["Flow", EPIC_ID] }));
    expect(migrated?.name).toBe("Flow work");
    expect(migrated?.filters).toEqual({ ...NO_PLACEMENT, parents: [] });
  });

  it("reads a view saved with a parent filter as it is", () => {
    expect(migrateSavedView(view({ ...NO_PLACEMENT, parents: [EPIC_ID] }))?.filters.parents).toEqual([EPIC_ID]);
  });
});
