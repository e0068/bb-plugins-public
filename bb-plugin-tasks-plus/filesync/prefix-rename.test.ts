// @vitest-environment node
import { describe, expect, it } from "vitest";
import { rekeyBoard, rewriteMentions } from "./prefix-rename.js";

const task = (id: string, key: string, number: number | null) => ({ id, key, number });

describe("rekeyBoard", () => {
  it("gives every numbered task the new prefix and keeps its number", () => {
    const keys = rekeyBoard([task("a", "SHA-1", 1), task("b", "SHA-12", 12)], { from: "SHA", to: "SL" });
    expect(Object.fromEntries(keys)).toEqual({ a: "SL-1", b: "SL-12" });
  });

  it("leaves a keyless task out", () => {
    const keys = rekeyBoard([task("a", "SHA-1", 1), task("b", "draft-idea", null)], { from: "SHA", to: "SL" });
    expect(keys.has("b")).toBe(false);
  });

  it("renames a task whose key kept an older prefix", () => {
    const keys = rekeyBoard([task("a", "BP-3", 3), task("b", "BBPL-7", 7)], { from: "SHA", to: "X" });
    expect(Object.fromEntries(keys)).toEqual({ a: "X-3", b: "X-7" });
  });

  it("gives the second of two equal numbers the next free number above all of them", () => {
    const keys = rekeyBoard([task("a", "BBPL-5", 5), task("b", "BP-5", 5), task("c", "BBPL-9", 9)], { from: "SHA", to: "X" });
    expect(Object.fromEntries(keys)).toEqual({ a: "X-5", b: "X-10", c: "X-9" });
  });

  it("lets a task that already has the new key keep it, so running it again changes nothing", () => {
    const first = rekeyBoard([task("a", "BP-5", 5), task("b", "X-5", 5)], { from: "SHA", to: "X" });
    expect(Object.fromEntries(first)).toEqual({ a: "X-6", b: "X-5" });
    const again = rekeyBoard([task("a", "X-6", 6), task("b", "X-5", 5)], { from: "SHA", to: "X" });
    expect(Object.fromEntries(again)).toEqual({ a: "X-6", b: "X-5" });
  });

  it("leaves the number to the task under the board's current prefix before one under an older prefix", () => {
    const keys = rekeyBoard([task("a", "BP-5", 5), task("b", "SHA-5", 5)], { from: "SHA", to: "SL" });
    expect(Object.fromEntries(keys)).toEqual({ a: "SL-6", b: "SL-5" });
  });

  it("never gives two tasks one key", () => {
    const tasks = [task("a", "A-1", 1), task("b", "B-1", 1), task("c", "C-1", 1), task("d", "A-2", 2), task("e", "B-2", 2)];
    const keys = [...rekeyBoard(tasks, { from: "SHA", to: "N" }).values()];
    expect(new Set(keys).size).toBe(tasks.length);
  });
});

describe("rewriteMentions", () => {
  const renames = new Map([
    ["SHA-12", "SL-12"],
    ["SHA-1", "SL-1"],
    ["BP-5", "X-6"],
    ["X-6", "X-7"],
  ]);

  it("replaces a key mentioned in prose and in a task directive", () => {
    expect(rewriteMentions('See SHA-12, then ::task{key="SHA-1"}.', renames)).toBe('See SL-12, then ::task{key="SL-1"}.');
  });

  it("replaces each mention once, so renames that chain do not run on", () => {
    expect(rewriteMentions("BP-5 and X-6", renames)).toBe("X-6 and X-7");
  });

  it("leaves a longer key that starts with a renamed one", () => {
    expect(rewriteMentions("SHA-123 and XSHA-12", renames)).toBe("SHA-123 and XSHA-12");
  });

  it("leaves keys of other boards and ordinary words", () => {
    expect(rewriteMentions("BBPL-12 is a COVID-19 story", renames)).toBe("BBPL-12 is a COVID-19 story");
  });

  it("leaves a key inside a file name or a path, which the rename does not move", () => {
    expect(rewriteMentions("docs/specs/SHA-12-foo.md and specs/SHA-12", renames)).toBe("docs/specs/SHA-12-foo.md and specs/SHA-12");
  });

  it("leaves a bare file name in prose, and still replaces a key that ends a sentence", () => {
    expect(rewriteMentions("Open SHA-12.md, then close SHA-12.", renames)).toBe("Open SHA-12.md, then close SL-12.");
  });

  it("leaves a lowercase slug alone", () => {
    expect(rewriteMentions("fix-sha-12-bug", renames)).toBe("fix-sha-12-bug");
  });
});
