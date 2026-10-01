import { describe, expect, it } from "vitest";
import { defaultConfig, normalizeFieldDisplay, type FieldDisplayConfig } from "./row-field-preference.js";

const fieldsOf = (config: { fields: { field: string; visible: boolean }[] }) =>
  Object.fromEntries(config.fields.map((entry) => [entry.field, entry.visible]));

describe("row fields per surface", () => {
  it("offers Slug, Status and Sub-tasks on both surfaces, the sub-task list only on the board", () => {
    const list = fieldsOf(defaultConfig("list"));
    const board = fieldsOf(defaultConfig("board"));
    for (const field of ["slug", "status", "subtasks"]) {
      expect(list).toHaveProperty(field);
      expect(board).toHaveProperty(field);
    }
    expect(list).not.toHaveProperty("subtaskList");
    expect(board).toHaveProperty("subtaskList", false);
  });

  it("keeps the board's sub-task counter on — the card always drew it — and brings the new fields in hidden", () => {
    const stored = { fields: [{ field: "priority", visible: true }], showEmpty: false, showDescription: false } as FieldDisplayConfig;
    const board = fieldsOf(normalizeFieldDisplay("board:B1", stored));
    expect(board).toMatchObject({ priority: true, subtasks: true, slug: false, status: false, subtaskList: false });
    expect(fieldsOf(normalizeFieldDisplay("all", stored))).toMatchObject({ subtasks: false, slug: false });
  });

  it("drops a board-only field a list config carries", () => {
    const stored = { fields: [{ field: "subtaskList", visible: true }], showEmpty: false, showDescription: false } as FieldDisplayConfig;
    expect(fieldsOf(normalizeFieldDisplay("all", stored))).not.toHaveProperty("subtaskList");
  });
});

describe("the key as a field", () => {
  it("offers Key on both surfaces, shown by default", () => {
    expect(fieldsOf(defaultConfig("list"))).toHaveProperty("key", true);
    expect(fieldsOf(defaultConfig("board"))).toHaveProperty("key", true);
  });

  it("keeps the key shown on a stored config that predates the field — both surfaces always drew it", () => {
    const stored = { fields: [{ field: "priority", visible: true }], showEmpty: false, showDescription: false } as FieldDisplayConfig;
    expect(fieldsOf(normalizeFieldDisplay("board:B1", stored))).toHaveProperty("key", true);
    expect(fieldsOf(normalizeFieldDisplay("all", stored))).toHaveProperty("key", true);
  });
});
