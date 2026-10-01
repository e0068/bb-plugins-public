import { describe, expect, it } from "vitest";
import {
  fieldDisplayConfigSchema,
  savedViewSchema,
  tasksRpcContract,
} from "./contract.js";

const VALID_ULID = "01J0000000000000000000000A";

const fullConfig = {
  fields: [
    { field: "priority", visible: true },
    { field: "active", visible: true },
    { field: "type", visible: true },
    { field: "estimate", visible: true },
    { field: "labels", visible: true },
    { field: "plannedMinutes", visible: true },
    { field: "actualMinutes", visible: true },
    { field: "budget", visible: true },
    { field: "budgetLimit", visible: true },
    { field: "cost", visible: true },
    { field: "dueDate", visible: true },
    { field: "project", visible: true },
    { field: "createdAt", visible: true },
    { field: "updatedAt", visible: true },
  ],
  showEmpty: false,
  showDescription: true,
};

describe("fieldDisplayConfigSchema", () => {
  it("accepts a full valid config with all fields", () => {
    expect(fieldDisplayConfigSchema.safeParse(fullConfig).success).toBe(true);
  });

  it("accepts a partial field list (view saved by an older client)", () => {
    const config = {
      fields: [
        { field: "priority", visible: true },
        { field: "labels", visible: false },
      ],
      showEmpty: false,
      showDescription: false,
    };
    expect(fieldDisplayConfigSchema.safeParse(config).success).toBe(true);
  });

  it("accepts an empty field list", () => {
    const config = { fields: [], showEmpty: true, showDescription: true };
    expect(fieldDisplayConfigSchema.safeParse(config).success).toBe(true);
  });

  it("rejects an unknown field name", () => {
    const config = {
      fields: [{ field: "bogus", visible: true }],
      showEmpty: false,
      showDescription: false,
    };
    expect(fieldDisplayConfigSchema.safeParse(config).success).toBe(false);
  });

  it("rejects a field repeated twice", () => {
    const config = {
      fields: [
        { field: "priority", visible: true },
        { field: "priority", visible: false },
      ],
      showEmpty: false,
      showDescription: false,
    };
    expect(fieldDisplayConfigSchema.safeParse(config).success).toBe(false);
  });

  it("rejects an unknown top-level key", () => {
    const config = { ...fullConfig, extra: true };
    expect(fieldDisplayConfigSchema.safeParse(config).success).toBe(false);
  });

  it("rejects a non-boolean visible", () => {
    const config = {
      fields: [{ field: "priority", visible: "yes" }],
      showEmpty: false,
      showDescription: false,
    };
    expect(fieldDisplayConfigSchema.safeParse(config).success).toBe(false);
  });

  it("rejects a missing showEmpty", () => {
    const config = { fields: [], showDescription: false };
    expect(fieldDisplayConfigSchema.safeParse(config).success).toBe(false);
  });
});

const emptyFilters = {
  statuses: [],
  priorities: [],
  types: [],
  estimates: [],
  labelNames: [],
  assignees: [],
  parents: [],
};

const validView = {
  id: VALID_ULID,
  version: 2,
  name: "My view",
  projectId: null,
  listScope: null,
  filters: emptyFilters,
  sort: "manual",
  fields: fullConfig,
  createdAt: "2026-07-01T00:00:00.000Z",
};

describe("savedViewSchema", () => {
  it("accepts a view that carries project, filters, sort and fields", () => {
    expect(savedViewSchema.safeParse(validView).success).toBe(true);
  });

  it("accepts a view bound to a project", () => {
    expect(
      savedViewSchema.safeParse({ ...validView, projectId: VALID_ULID })
        .success,
    ).toBe(true);
  });

  it("accepts a view bound to the active surface", () => {
    expect(
      savedViewSchema.safeParse({ ...validView, listScope: "active" }).success,
    ).toBe(true);
  });

  it("rejects a view that names both a project and a surface", () => {
    expect(
      savedViewSchema.safeParse({
        ...validView,
        projectId: VALID_ULID,
        listScope: "waiting",
      }).success,
    ).toBe(false);
  });

  it("rejects a record of the first-pass shape, so migration has to handle it", () => {
    expect(
      savedViewSchema.safeParse({
        id: VALID_ULID,
        scope: "all",
        name: "My view",
        config: fullConfig,
        createdAt: "2026-07-01T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("rejects a non-ULID id", () => {
    expect(
      savedViewSchema.safeParse({ ...validView, id: "not-a-ulid" }).success,
    ).toBe(false);
  });

  it("rejects an unknown top-level key (strict)", () => {
    expect(
      savedViewSchema.safeParse({ ...validView, extra: true }).success,
    ).toBe(false);
  });

  it("rejects a sort outside the list sorts", () => {
    expect(
      savedViewSchema.safeParse({ ...validView, sort: "sideways" }).success,
    ).toBe(false);
  });

  it("rejects a view whose fields config has an unknown field", () => {
    const fields = {
      ...fullConfig,
      fields: [{ field: "bogus", visible: true }],
    };
    expect(savedViewSchema.safeParse({ ...validView, fields }).success).toBe(
      false,
    );
  });
});

describe("createSavedView input", () => {
  const schema = tasksRpcContract.createSavedView.input;
  const base = {
    name: "My view",
    projectId: null,
    listScope: null,
    filters: emptyFilters,
    sort: "manual",
    fields: fullConfig,
  };

  it("accepts a view of the new shape", () => {
    expect(schema.safeParse(base).success).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(schema.safeParse({ ...base, name: "" }).success).toBe(false);
  });

  it("rejects a blank (whitespace-only) name", () => {
    expect(schema.safeParse({ ...base, name: "   " }).success).toBe(false);
  });

  it("trims a name with surrounding whitespace", () => {
    const parsed = schema.parse({ ...base, name: "  My view  " });
    expect(parsed.name).toBe("My view");
  });

  it("rejects a name longer than 60 characters", () => {
    expect(schema.safeParse({ ...base, name: "a".repeat(61) }).success).toBe(
      false,
    );
  });

  it("accepts a name of exactly 60 characters", () => {
    expect(schema.safeParse({ ...base, name: "a".repeat(60) }).success).toBe(
      true,
    );
  });

  it("rejects an unknown top-level key (strict)", () => {
    expect(schema.safeParse({ ...base, extra: true }).success).toBe(false);
  });
});

describe("updateSavedView input", () => {
  const schema = tasksRpcContract.updateSavedView.input;

  it("renames a view", () => {
    const parsed = schema.parse({ savedViewId: VALID_ULID, name: "  Mine  " });
    expect(parsed.name).toBe("Mine");
  });

  it("rejects an empty name", () => {
    expect(
      schema.safeParse({ savedViewId: VALID_ULID, name: "  " }).success,
    ).toBe(false);
  });

  it("rejects a savedViewId that is not a ULID", () => {
    expect(schema.safeParse({ savedViewId: "nope", name: "Mine" }).success).toBe(
      false,
    );
  });
});

describe("deleteSavedView input", () => {
  it("rejects a savedViewId that is not a ULID", () => {
    expect(
      tasksRpcContract.deleteSavedView.input.safeParse({
        savedViewId: "not-a-ulid",
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown top-level key (strict)", () => {
    expect(
      tasksRpcContract.deleteSavedView.input.safeParse({
        savedViewId: VALID_ULID,
        extra: true,
      }).success,
    ).toBe(false);
  });
});

describe("listSavedViews input", () => {
  it("takes no arguments: views are no longer partitioned by surface", () => {
    expect(tasksRpcContract.listSavedViews.input.safeParse({}).success).toBe(
      true,
    );
  });

  it("rejects a leftover scope argument (strict)", () => {
    expect(
      tasksRpcContract.listSavedViews.input.safeParse({ scope: "all" }).success,
    ).toBe(false);
  });
});
