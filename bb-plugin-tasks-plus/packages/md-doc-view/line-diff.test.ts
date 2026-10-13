import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { lineDiff } from "./line-diff";

// A line generator that avoids "\n" — the separator itself is what the
// function splits on, so a generated newline would silently change the line
// count the property is about.
const line = fc.string({ unit: "grapheme-ascii", maxLength: 20 }).map((s) => s.replace(/\n/g, ""));
const lines = (max = 30) => fc.array(line, { maxLength: max });
const text = (max = 30) => lines(max).map((ls) => ls.join("\n"));

describe("lineDiff — properties", () => {
  it("the same text on both sides counts nothing", () => {
    fc.assert(
      fc.property(text(), (t) => {
        expect(lineDiff(t, t)).toEqual({ added: 0, removed: 0 });
      }),
    );
  });

  it("appending n lines counts added = n and removed = 0", () => {
    fc.assert(
      fc.property(lines(), lines(10), (base, extra) => {
        fc.pre(extra.length > 0);
        const before = base.join("\n");
        const after = [...base, ...extra].join("\n");
        // Joining an empty base to a non-empty tail glues the first extra line
        // onto the empty document rather than adding a line below it.
        fc.pre(base.length > 0);
        expect(lineDiff(before, after)).toEqual({
          added: extra.length,
          removed: 0,
        });
      }),
    );
  });

  it("dropping n lines off the end counts removed = n and added = 0", () => {
    fc.assert(
      fc.property(lines(), lines(10), (base, tail) => {
        fc.pre(base.length > 0 && tail.length > 0);
        const before = [...base, ...tail].join("\n");
        const after = base.join("\n");
        expect(lineDiff(before, after)).toEqual({
          added: 0,
          removed: tail.length,
        });
      }),
    );
  });

  it("lineDiff(a, b) mirrors lineDiff(b, a) — added and removed swap", () => {
    fc.assert(
      fc.property(text(), text(), (a, b) => {
        const forward = lineDiff(a, b);
        const backward = lineDiff(b, a);
        expect(backward).toEqual({
          added: forward.removed,
          removed: forward.added,
        });
      }),
    );
  });
});

describe("lineDiff — edges", () => {
  it("empty on both sides counts nothing", () => {
    expect(lineDiff("", "")).toEqual({ added: 0, removed: 0 });
  });

  it("editing one line counts exactly +1 and -1", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc")).toEqual({ added: 1, removed: 1 });
  });

  it("a missing final newline counts as one line less, nothing else", () => {
    expect(lineDiff("a\nb", "a\nb\n")).toEqual({ added: 1, removed: 0 });
    expect(lineDiff("a\nb\nc", "a\nb\nc\n")).toEqual({ added: 1, removed: 0 });
    // The lines above the last one are untouched either way.
    expect(lineDiff("a\nb\n", "a\nB\n")).toEqual({ added: 1, removed: 1 });
  });

  it("inserting a line in the middle leaves the tail uncounted", () => {
    const before = "a\nb\nc\nd\ne";
    const after = "a\nb\nX\nc\nd\ne";
    expect(lineDiff(before, after)).toEqual({ added: 1, removed: 0 });
  });

  it("moving a line counts it once as removed and once as added", () => {
    expect(lineDiff("a\nb\nc", "b\nc\na")).toEqual({ added: 1, removed: 1 });
  });

  it("a one-line edit in a 2000-line file is counted in under 50 ms", () => {
    const base = Array.from({ length: 2000 }, (_, i) => `line ${i}`);
    const edited = [...base];
    edited[1000] = "line 1000 — edited";
    const before = base.join("\n");
    const after = edited.join("\n");

    const started = performance.now();
    const result = lineDiff(before, after);
    const spent = performance.now() - started;

    expect(result).toEqual({ added: 1, removed: 1 });
    expect(spent).toBeLessThan(50);
  });

  // The capped window: above MAX_CELLS the two sides are counted as wholly
  // replaced rather than lined up. Without a case this big the branch is
  // unreachable from the suite, and the cap could be removed without a single
  // test noticing.
  it("two large texts with nothing in common are counted as wholly replaced", () => {
    const before = Array.from({ length: 1500 }, (_, i) => `old ${i}`).join("\n");
    const after = Array.from({ length: 1400 }, (_, i) => `new ${i}`).join("\n");

    const started = performance.now();
    const result = lineDiff(before, after);
    const spent = performance.now() - started;

    expect(result).toEqual({ added: 1400, removed: 1500 });
    expect(spent).toBeLessThan(50);
  });

  it("two whole files with nothing in common count every line on both sides", () => {
    const before = Array.from({ length: 40 }, (_, i) => `old ${i}`).join("\n");
    const after = Array.from({ length: 25 }, (_, i) => `new ${i}`).join("\n");
    expect(lineDiff(before, after)).toEqual({ added: 25, removed: 40 });
  });
});
