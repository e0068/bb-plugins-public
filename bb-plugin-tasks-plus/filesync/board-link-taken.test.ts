import { describe, expect, it } from "vitest";
import { linkTakenBy, type BoardConfig } from "./board-config.js";

const board = (id: string, linkedBbProjectId: string | null): BoardConfig => ({
  id,
  name: id,
  prefix: id.toUpperCase(),
  color: "blue",
  folderId: null,
  linkedBbProjectId,
  tasksFolder: "docs/tasks",
  database: null,
  createdAt: "2026-01-01T00:00:00.000Z",
});

const BOARDS = [board("a", "proj_one"), board("b", null), board("c", "proj_two")];

describe("the board that took a bb project", () => {
  it("is found by the bb project it is linked to", () => {
    expect(linkTakenBy(BOARDS, "proj_one")?.id).toBe("a");
  });

  it("is nobody when no board is linked to that bb project", () => {
    expect(linkTakenBy(BOARDS, "proj_free")).toBeUndefined();
  });

  it("does not count the board being written itself", () => {
    expect(linkTakenBy(BOARDS, "proj_one", "a")).toBeUndefined();
    expect(linkTakenBy(BOARDS, "proj_one", "c")?.id).toBe("a");
  });

  it("is nobody for an unlinked board, however many unlinked boards there are", () => {
    expect(linkTakenBy([...BOARDS, board("d", null)], null)).toBeUndefined();
  });
});

describe("a board's icon", () => {
  it("is an optional field of the board record", () => {
    const withIcon: BoardConfig = { ...board("e", null), icon: "Rocket" };
    expect(withIcon.icon).toBe("Rocket");
    expect(board("f", null).icon).toBeUndefined();
  });
});
