import { describe, expect, it } from "vitest";
import { canGoBack, current, goBack, initStack, jumpTo } from "./jump-stack";

describe("initStack", () => {
  it("текущий — первый элемент, назад некуда", () => {
    const s = initStack("/a.md");
    expect(current(s)).toBe("/a.md");
    expect(canGoBack(s)).toBe(false);
  });
});

describe("jumpTo", () => {
  it("толкает новый путь и меняет current", () => {
    const s1 = initStack("/a.md");
    const s2 = jumpTo(s1, "/b.md");
    expect(current(s2)).toBe("/b.md");
    expect(canGoBack(s2)).toBe(true);
    expect(s2.stack).toEqual(["/a.md", "/b.md"]);
  });

  it("тем же путём подряд не даёт дубля", () => {
    const s1 = initStack("/a.md");
    const s2 = jumpTo(s1, "/a.md");
    expect(s2).toBe(s1);
    expect(s2.stack).toEqual(["/a.md"]);
  });
});

describe("goBack", () => {
  it("возвращает предыдущий элемент", () => {
    const s1 = initStack("/a.md");
    const s2 = jumpTo(s1, "/b.md");
    const s3 = goBack(s2);
    expect(current(s3)).toBe("/a.md");
    expect(canGoBack(s3)).toBe(false);
  });

  it("на корне не падает (no-op)", () => {
    const s1 = initStack("/a.md");
    const s2 = goBack(s1);
    expect(current(s2)).toBe("/a.md");
    expect(s2).toBe(s1);
  });
});
