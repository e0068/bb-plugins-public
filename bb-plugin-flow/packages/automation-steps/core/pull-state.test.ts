import { describe, expect, it } from "vitest";

import { parsePullState } from "./github-requests";

describe("parsePullState", () => {
  it("влитый PR виден по своему признаку, даже когда состояние закрыто", () => {
    expect(parsePullState({ state: "closed", merged: true })).toBe("merged");
  });

  it("открытый — работа, закрытый без мёрджа — отказ", () => {
    expect(parsePullState({ state: "open", merged: false })).toBe("open");
    expect(parsePullState({ state: "closed", merged: false })).toBe("closed");
  });

  it("непонятный ответ не выдаётся за состояние", () => {
    expect(parsePullState(null)).toBe("unknown");
    expect(parsePullState({ message: "Not Found" })).toBe("unknown");
    expect(parsePullState("open")).toBe("unknown");
  });
});
