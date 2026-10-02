// @vitest-environment node
import { describe, expect, it } from "vitest";

import { linkApart } from "./sub-stages";

const s = (id: string, parent?: string) => ({ id, ...(parent === undefined ? {} : { parent }) });

describe("отступ связки в таблице", () => {
  it("связка отходит от соседей сверху и снизу, внутри и между одиночными этапами отступа нет", () => {
    const stages = [s("ship"), s("preview", "demo"), s("demo"), s("restore", "demo"), s("merge"), s("done")];
    expect(stages.map((_, at) => linkApart(stages, at))).toEqual([false, true, false, false, true, false]);
    expect(linkApart(stages, stages.length)).toBe(false);
  });

  it("связка с краю списка отходит от шапки и от строки добавления", () => {
    const stages = [s("demo"), s("restore", "demo")];
    expect(linkApart(stages, 0)).toBe(true);
    expect(linkApart(stages, stages.length)).toBe(true);
  });

  it("две связки подряд разделены одним отступом", () => {
    const stages = [s("a"), s("a1", "a"), s("b"), s("b1", "b")];
    expect(stages.map((_, at) => linkApart(stages, at))).toEqual([true, false, true, false]);
  });

  it("этап без под-этапов связкой не считается", () => {
    expect(linkApart([s("a"), s("b")], 1)).toBe(false);
  });
});
