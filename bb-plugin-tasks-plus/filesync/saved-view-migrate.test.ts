// @vitest-environment node
import { describe, expect, it } from "vitest";
import { migrateSavedView } from "./saved-view-migrate.js";

const ULID = "01J0000000000000000000000A";
const PROJECT = "01J0000000000000000000000B";

const config = {
  fields: [
    { field: "priority", visible: true },
    { field: "dueDate", visible: false },
  ],
  showEmpty: false,
  showDescription: true,
};

const firstPass = (scope: string) => ({
  id: ULID,
  scope,
  name: "My view",
  config,
  createdAt: "2026-07-01T00:00:00.000Z",
});

describe("migrateSavedView", () => {
  it("returns a current board view untouched", () => {
    const current = {
      id: ULID,
      version: 2 as const,
      name: "My board",
      projectId: PROJECT,
      listScope: null,
      surface: "board" as const,
      filters: {
        statuses: [],
        priorities: [],
        types: [],
        estimates: [],
        labelNames: [],
        assignees: [],
        parents: [],
      },
      sort: "manual" as const,
      fields: config,
      board: { groupBy: "priority" as const, columns: {}, hideEmpty: false },
      table: null,
      createdAt: "2026-07-01T00:00:00.000Z",
    };
    expect(migrateSavedView(current)).toEqual(current);
  });

  it("reads scope all as a view over every project", () => {
    const view = migrateSavedView(firstPass("all"));
    expect(view?.projectId).toBe(null);
    expect(view?.listScope).toBe(null);
  });

  it("reads scope active as the active surface", () => {
    expect(migrateSavedView(firstPass("active"))?.listScope).toBe("active");
  });

  it("reads scope waiting as the waiting surface", () => {
    expect(migrateSavedView(firstPass("waiting"))?.listScope).toBe("waiting");
  });

  it("reads a project scope as that project", () => {
    const view = migrateSavedView(firstPass(`project:${PROJECT}`));
    expect(view?.projectId).toBe(PROJECT);
    expect(view?.listScope).toBe(null);
  });

  it("reads a board scope as that project too", () => {
    expect(migrateSavedView(firstPass(`board:${PROJECT}`))?.projectId).toBe(
      PROJECT,
    );
  });

  it("carries the saved columns over", () => {
    expect(migrateSavedView(firstPass("all"))?.fields).toEqual(config);
  });

  it("starts a migrated view with no filters and manual order", () => {
    const view = migrateSavedView(firstPass("all"));
    expect(view?.filters.statuses).toEqual([]);
    expect(view?.filters.assignees).toEqual([]);
    expect(view?.sort).toBe("manual");
  });

  it("keeps the name, id and creation time", () => {
    const view = migrateSavedView(firstPass("all"));
    expect(view?.id).toBe(ULID);
    expect(view?.name).toBe("My view");
    expect(view?.createdAt).toBe("2026-07-01T00:00:00.000Z");
  });

  it("keeps a first-pass view whose columns name a retired field, minus that field", () => {
    const view = migrateSavedView({
      ...firstPass("all"),
      config: {
        fields: [
          { field: "tokens", visible: true },
          { field: "labels", visible: true },
        ],
        showEmpty: false,
        showDescription: false,
      },
    });
    expect(view?.fields.fields).toEqual([{ field: "labels", visible: true }]);
  });

  it("keeps a current view whose columns name a retired field", () => {
    const current = {
      id: ULID,
      version: 2 as const,
      name: "My view",
      projectId: null,
      listScope: null,
      filters: {
        statuses: [],
        priorities: [],
        types: [],
        estimates: [],
        labelNames: [],
        assignees: [],
        parents: [],
      },
      sort: "manual" as const,
      fields: {
        fields: [
          { field: "tokens", visible: true },
          { field: "labels", visible: true },
        ],
        showEmpty: false,
        showDescription: false,
      },
      createdAt: "2026-07-01T00:00:00.000Z",
    };
    expect(migrateSavedView(current)?.fields.fields).toEqual([
      { field: "labels", visible: true },
    ]);
  });

  it("drops a record whose scope grammar is unknown", () => {
    expect(migrateSavedView(firstPass("sideways:7"))).toBe(null);
  });

  it("drops a project scope without an identifier", () => {
    expect(migrateSavedView(firstPass("project:"))).toBe(null);
  });

  it("drops anything that is not a record", () => {
    expect(migrateSavedView(null)).toBe(null);
    expect(migrateSavedView("view")).toBe(null);
    expect(migrateSavedView(42)).toBe(null);
  });

  it("drops a first-pass record whose columns are unusable", () => {
    expect(migrateSavedView({ ...firstPass("all"), config: "nope" })).toBe(null);
  });
});
