import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  canGoBack,
  canGoForward,
  goBack,
  goForward,
  removePath,
  renamePath,
  startAt,
  visit,
  type DocHistory,
} from "./doc-history";

const path = fc.constantFrom("/a.md", "/b.md", "/c.md", "/d.md");

// Any history a reader can reach: a start, then jumps and steps in any order.
const history: fc.Arbitrary<DocHistory> = fc
  .tuple(
    path,
    fc.array(
      fc.oneof(
        path.map((p) => (h: DocHistory) => visit(h, p)),
        fc.constant(goBack),
        fc.constant(goForward),
      ),
      { maxLength: 12 },
    ),
  )
  .map(([first, steps]) => steps.reduce((h, step) => step(h), startAt(first)));

const all = (h: DocHistory) => [...h.back, h.current, ...h.forward];

describe("doc history — stepping", () => {
  it("a fresh history has nowhere to go", () => {
    const h = startAt("/a.md");
    expect(h.current).toBe("/a.md");
    expect(canGoBack(h)).toBe(false);
    expect(canGoForward(h)).toBe(false);
  });

  it("back then forward returns to the same history", () => {
    fc.assert(
      fc.property(history, (h) => {
        fc.pre(canGoBack(h));
        expect(goForward(goBack(h))).toEqual(h);
      }),
    );
  });

  it("forward then back returns to the same history", () => {
    fc.assert(
      fc.property(history, (h) => {
        fc.pre(canGoForward(h));
        expect(goBack(goForward(h))).toEqual(h);
      }),
    );
  });

  it("a step with nowhere to go leaves the history as it was", () => {
    fc.assert(
      fc.property(history, (h) => {
        if (!canGoBack(h)) expect(goBack(h)).toEqual(h);
        if (!canGoForward(h)) expect(goForward(h)).toEqual(h);
      }),
    );
  });

  it("a jump from the middle wipes what lay ahead", () => {
    fc.assert(
      fc.property(history, path, (h, p) => {
        fc.pre(p !== h.current);
        const next = visit(h, p);
        expect(next.current).toBe(p);
        expect(canGoForward(next)).toBe(false);
        expect(canGoBack(next)).toBe(h.current !== null || h.back.length > 0);
      }),
    );
  });

  it("a jump to the file already on screen changes nothing", () => {
    fc.assert(
      fc.property(history, (h) => {
        fc.pre(h.current !== null);
        expect(visit(h, h.current as string)).toEqual(h);
      }),
    );
  });

  it("back walks the files in the order they were opened", () => {
    const h = visit(visit(startAt("/a.md"), "/b.md"), "/c.md");
    expect(goBack(h).current).toBe("/b.md");
    expect(goBack(goBack(h)).current).toBe("/a.md");
    expect(goForward(goBack(goBack(h))).current).toBe("/b.md");
  });
});

describe("doc history — renaming and removing a file", () => {
  it("a rename replaces the path everywhere and keeps every part's length", () => {
    fc.assert(
      fc.property(history, path, (h, from) => {
        const next = renamePath(h, from, "/renamed.md");
        expect(all(next)).not.toContain(from);
        expect(next.back.length).toBe(h.back.length);
        expect(next.forward.length).toBe(h.forward.length);
      }),
    );
  });

  it("a removal leaves the path nowhere in the history", () => {
    fc.assert(
      fc.property(history, path, (h, gone) => {
        expect(all(removePath(h, gone))).not.toContain(gone);
      }),
    );
  });

  it("a removal never leaves the same file twice in a row", () => {
    fc.assert(
      fc.property(history, path, (h, gone) => {
        const next = removePath(h, gone);
        const line = all(next).filter((p) => p !== null);
        line.forEach((p, i) => expect(p).not.toBe(line[i + 1]));
      }),
    );
  });

  it("removing the file on screen leaves back pointing at the one before it", () => {
    const h = removePath(visit(startAt("/a.md"), "/b.md"), "/b.md");
    expect(h.current).toBeNull();
    expect(canGoBack(h)).toBe(true);
    expect(goBack(h).current).toBe("/a.md");
  });
});
