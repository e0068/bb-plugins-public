import { describe, expect, it } from "vitest";

import { liveFlowId } from "./run-history";

const FLOWS = [
  { id: "flow-code", name: "Code" },
  { id: "flow-bug", name: "Bug" },
];

describe("liveFlowId — id flow строки истории, пока flow жив", () => {
  it("сохранённый id живого flow — он и есть", () => {
    expect(liveFlowId(FLOWS, "flow-bug", "Code")).toBe("flow-bug");
  });

  it("итог без id находит flow по названию", () => {
    expect(liveFlowId(FLOWS, undefined, "Code")).toBe("flow-code");
  });

  it("удалённый flow — id нет, даже если название совпало с живым", () => {
    expect(liveFlowId(FLOWS, "flow-gone", "Code")).toBeUndefined();
  });

  it("ни id, ни названия — id нет", () => {
    expect(liveFlowId(FLOWS, undefined, undefined)).toBeUndefined();
    expect(liveFlowId(FLOWS, undefined, "Никакой")).toBeUndefined();
  });
});
