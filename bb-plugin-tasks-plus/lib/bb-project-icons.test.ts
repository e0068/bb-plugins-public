import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT_ICON } from "@bb-plugins/icon-catalog";
import { bbProjectIcons } from "./bb-project-icons";
import { iconDrawing } from "./icon-drawing";

const board = { id: "B1", icon: "🚀", color: "steelblue", linkedBbProjectId: "proj_a1", database: null };
const section = { id: "S1", icon: "📄", color: "red", linkedBbProjectId: "proj_a1", database: { table: "docs0001" } };
const plain = { id: "B2", color: "seagreen", linkedBbProjectId: "proj_b2" };
const unlinked = { id: "B3", icon: "🔥", color: "red", linkedBbProjectId: null };

describe("the icons of bb projects", () => {
  it("draw the icon of the board linked to the project, not of a section beside it", () => {
    expect(bbProjectIcons([section, board])).toEqual([{ bbProjectId: "proj_a1", drawing: { kind: "emoji", char: "🚀" } }]);
  });

  it("draw a board without an icon of its own as bb's thread list does: the default sign in the board's colour", () => {
    expect(bbProjectIcons([plain])).toEqual([{ bbProjectId: "proj_b2", drawing: iconDrawing(undefined, DEFAULT_PROJECT_ICON, "seagreen") }]);
  });

  it("leave out boards linked to no project and projects with only a section", () => {
    expect(bbProjectIcons([unlinked, section])).toEqual([]);
  });
});
