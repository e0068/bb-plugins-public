import { describe, expect, it } from "vitest";

import { readsSetting } from "./analytics-tile.js";

describe("readsSetting", () => {
  it("follows the type's settings", () => {
    expect(readsSetting("ring", "value", "contents")).toBe(true);
    expect(readsSetting("ring", "value", "axes")).toBe(false);
    expect(readsSetting("line", "value", "contents")).toBe(false);
  });

  it("gives a Gantt — bars run Start → Due — no axis labels, grid or segment contents", () => {
    expect((["axes", "grid", "contents"] as const).map((setting) => readsSetting("bars", "range", setting))).toEqual([false, false, false]);
    expect((["axes", "grid", "contents"] as const).map((setting) => readsSetting("bars", "value", setting))).toEqual([true, true, true]);
    expect(readsSetting("bars", "range", "legend")).toBe(true);
  });
});
