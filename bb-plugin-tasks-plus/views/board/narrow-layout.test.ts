// @vitest-environment node
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { TaskStatus } from "../../shared/enums.js";
import { visibleBoardColumns } from "./narrow-layout.js";

const statuses: TaskStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
];

describe("visibleBoardColumns", () => {
  it("shows every status on a wide board", () => {
    expect(visibleBoardColumns(false, statuses, null)).toEqual(statuses);
    expect(visibleBoardColumns(false, statuses, "done")).toEqual(statuses);
  });

  it("shows exactly the picked status on a narrow board", () => {
    expect(visibleBoardColumns(true, statuses, "done")).toEqual(["done"]);
  });

  it("falls back to the first status when none is picked", () => {
    expect(visibleBoardColumns(true, statuses, null)).toEqual(["backlog"]);
  });

  it("falls back to the first status when the picked one left the board", () => {
    expect(visibleBoardColumns(true, statuses, "canceled")).toEqual(["backlog"]);
  });

  it("shows nothing when the board has no statuses at all", () => {
    expect(visibleBoardColumns(true, [], null)).toEqual([]);
    expect(visibleBoardColumns(false, [], null)).toEqual([]);
  });

  it("always shows a subset of the board's own statuses", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.option(fc.constantFrom(...statuses), { nil: null }),
        (isNarrow, selected) => {
          for (const status of visibleBoardColumns(isNarrow, statuses, selected)) {
            expect(statuses).toContain(status);
          }
        },
      ),
    );
  });

  it("shows either one column or all of them, never something in between", () => {
    fc.assert(
      fc.property(fc.boolean(), (isNarrow) => {
        const shown = visibleBoardColumns(isNarrow, statuses, null).length;
        expect([1, statuses.length]).toContain(shown);
      }),
    );
  });
});
