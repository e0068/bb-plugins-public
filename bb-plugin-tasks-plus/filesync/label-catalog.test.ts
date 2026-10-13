// @vitest-environment node
import { describe, expect, it } from "vitest";
import { boardLabelList, labelColor, renamedLabel, withLabel, withoutLabel } from "./label-catalog.js";
import { LABEL_COLOR } from "../shared/enums.js";

const RED = "#ef4444";
const BLUE = "#3b82f6";

describe("a board's label catalog", () => {
  it("adds a new name last and recolours a known one in place", () => {
    const catalog = withLabel(withLabel([], "urgent", RED), "later", BLUE);
    expect(withLabel(catalog, "urgent", BLUE)).toEqual([{ name: "urgent", color: BLUE }, { name: "later", color: BLUE }]);
  });

  it("drops a name", () => {
    expect(withoutLabel([{ name: "urgent", color: RED }], "urgent")).toEqual([]);
  });

  it("renames in place, folding into a name it already holds", () => {
    const catalog = [{ name: "urgent", color: RED }, { name: "later", color: BLUE }];
    expect(renamedLabel(catalog, "urgent", "now", RED)).toEqual([{ name: "now", color: RED }, { name: "later", color: BLUE }]);
    expect(renamedLabel(catalog, "urgent", "later", RED)).toEqual([{ name: "later", color: RED }]);
    expect(renamedLabel(catalog, "urgent", "urgent", BLUE)).toEqual([{ name: "urgent", color: BLUE }, { name: "later", color: BLUE }]);
    expect(renamedLabel(catalog, "urgent", "now")).toEqual([{ name: "now", color: RED }, { name: "later", color: BLUE }]);
    expect(renamedLabel([], "carried", "kept", RED)).toEqual([{ name: "kept", color: RED }]);
    expect(renamedLabel(catalog, "carried", "later")).toEqual(catalog);
    expect(renamedLabel([], "carried", "kept")).toEqual([{ name: "kept", color: LABEL_COLOR }]);
  });

  it("lists the catalog first, then the carried names it lacks, grey", () => {
    expect(boardLabelList([{ name: "urgent", color: RED }], ["later", "urgent", "later"])).toEqual([
      { name: "urgent", color: RED },
      { name: "later", color: LABEL_COLOR },
    ]);
    expect(labelColor([{ name: "urgent", color: RED }], "later")).toBe(LABEL_COLOR);
  });
});
