import { describe, expect, it } from "vitest";
import type { FieldPlanCell } from "../common/field-plan.js";
import type { RowField } from "../common/row-field-preference.js";
import { cardSections } from "./card-sections.js";

const value = (field: RowField): FieldPlanCell => ({ field, mode: "value" });
const placeholder = (field: RowField): FieldPlanCell => ({ field, mode: "placeholder" });

/** A section as one readable token: a block by its field, a chip row by its fields joined. */
const shape = (cells: readonly FieldPlanCell[]) =>
  cardSections(cells).map((section) =>
    section.kind === "block" ? section.field : section.cells.map((cell) => cell.field).join("+"),
  );

describe("cardSections", () => {
  it("draws the fields in the order they come, a block standing where it is listed", () => {
    expect(shape([value("subtaskList"), value("key"), value("subtaskStats")])).toEqual([
      "subtaskList",
      "key",
      "subtaskStats",
    ]);
  });

  it("gathers chips that follow each other into one row", () => {
    expect(shape([value("key"), value("priority"), value("labels")])).toEqual(["key+priority+labels"]);
  });

  it("splits chips around a block into a row before it and a row after it", () => {
    expect(shape([value("key"), value("burndown"), value("priority"), value("dueDate")])).toEqual([
      "key",
      "burndown",
      "priority+dueDate",
    ]);
  });

  it("keeps a chip placeholder in its row and leaves a block placeholder out", () => {
    const sections = cardSections([value("key"), placeholder("subtaskStats"), placeholder("assignee")]);
    expect(sections).toEqual([{ kind: "chips", cells: [value("key"), placeholder("assignee")] }]);
  });

  it("draws the slug where it is listed, as a chip", () => {
    expect(shape([value("key"), value("labels"), value("slug"), value("description")])).toEqual(["key+labels+slug", "description"]);
  });

  it("stands the title as a block, the chips listed above it in their own row", () => {
    expect(shape([value("parent"), value("slug"), value("title"), value("key")])).toEqual(["parent+slug", "title", "key"]);
  });

  it("draws a card of nothing but its title as that one block", () => {
    expect(shape([value("title")])).toEqual(["title"]);
  });

  it("gives an empty plan no sections", () => {
    expect(cardSections([])).toEqual([]);
  });
});
