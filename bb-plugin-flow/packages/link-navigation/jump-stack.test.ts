import { describe, expect, it } from "vitest";
import { canGoBack, current, goBack, initStack, jumpTo } from "./jump-stack";

describe("initStack", () => {
  it("current is the first element, nowhere to go back", () => {
    const s = initStack("/a.md");
    expect(current(s)).toBe("/a.md");
    expect(canGoBack(s)).toBe(false);
  });
});

describe("jumpTo", () => {
  it("pushes a new path and changes current", () => {
    const s1 = initStack("/a.md");
    const s2 = jumpTo(s1, "/b.md");
    expect(current(s2)).toBe("/b.md");
    expect(canGoBack(s2)).toBe(true);
    expect(s2.stack).toEqual(["/a.md", "/b.md"]);
  });

  it("the same path in a row doesn't produce a duplicate", () => {
    const s1 = initStack("/a.md");
    const s2 = jumpTo(s1, "/a.md");
    expect(s2).toBe(s1);
    expect(s2.stack).toEqual(["/a.md"]);
  });
});

describe("goBack", () => {
  it("returns to the previous element", () => {
    const s1 = initStack("/a.md");
    const s2 = jumpTo(s1, "/b.md");
    const s3 = goBack(s2);
    expect(current(s3)).toBe("/a.md");
    expect(canGoBack(s3)).toBe(false);
  });

  it("doesn't fail at the root (no-op)", () => {
    const s1 = initStack("/a.md");
    const s2 = goBack(s1);
    expect(current(s2)).toBe("/a.md");
    expect(s2).toBe(s1);
  });
});
