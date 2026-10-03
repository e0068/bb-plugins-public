// @vitest-environment node
import { describe, expect, it } from "vitest";

import { stageApart } from "./sub-stages";

const s = (id: string, parent?: string) => ({ id, ...(parent === undefined ? {} : { parent }) });

describe("отступ между этапами в таблице", () => {
  it("каждый этап верхнего уровня отходит от соседа, под-этапы стоят вплотную к своему владельцу", () => {
    const stages = [s("ship"), s("preview", "demo"), s("demo"), s("restore", "demo"), s("merge"), s("done")];
    expect(stages.map((_, at) => stageApart(stages, at))).toEqual([false, true, false, false, true, true]);
  });

  it("первая строка и место за концом списка не отходят", () => {
    const stages = [s("demo"), s("restore", "demo")];
    expect(stageApart(stages, 0)).toBe(false);
    expect(stageApart(stages, stages.length)).toBe(false);
  });

  it("две связки подряд разделены одним отступом", () => {
    const stages = [s("a"), s("a1", "a"), s("b"), s("b1", "b")];
    expect(stages.map((_, at) => stageApart(stages, at))).toEqual([false, false, true, false]);
  });
});
