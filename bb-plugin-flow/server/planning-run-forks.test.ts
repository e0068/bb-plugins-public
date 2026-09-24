// @vitest-environment node
import { describe, expect, it } from "vitest";

import { withDescendants, type ThreadTree } from "./planning";

/** Родство двумя связями: дочерний тред по `parentThreadId`, боковой чат — скрытый форк по `sourceThreadId`. */
const world = (links: ReadonlyArray<{ id: string; parent?: string; source?: string }>): ThreadTree => ({
  threads: {
    list: async ({ parentThreadId, sourceThreadId, archived }) =>
      archived === true
        ? []
        : links.filter((link) => (parentThreadId !== undefined && link.parent === parentThreadId) || (sourceThreadId !== undefined && link.source === sourceThreadId)).map(({ id }) => ({ id })),
  },
});

describe("боковые чаты тредов прогона", () => {
  it("форк треда прогона — боковой чат — в счёте вместе со своими потомками", async () => {
    const source = world([{ id: "thr_side", source: "thr_b" }, { id: "thr_side_kid", parent: "thr_side" }, { id: "thr_kid_side", source: "thr_kid" }, { id: "thr_kid", parent: "thr_b" }]);
    expect((await withDescendants(source, ["thr_a", "thr_b"])).sort()).toEqual(["thr_a", "thr_b", "thr_kid", "thr_kid_side", "thr_side", "thr_side_kid"]);
  });

  it("форк чужого треда в счёт не попадает", async () => {
    const source = world([{ id: "thr_side", source: "thr_stranger" }]);
    expect(await withDescendants(source, ["thr_a"])).toEqual(["thr_a"]);
  });
});
