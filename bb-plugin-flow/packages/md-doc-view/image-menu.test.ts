// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { alignCenter, alignLeft, alignRight, maxNone, withMaxWidth } from "../kasimov/kasimov.js";
import type { KasimovImage, KasimovImageActions, KasimovMax } from "../kasimov/kasimov.js";
import {
  MAX_WIDTH,
  WIDTH_DELAY_MS,
  type Schedule,
  imageMenuSpec,
  trailing,
  widthOfMax,
} from "./image-menu";

const picture = (over: Partial<KasimovImage> = {}): KasimovImage => ({
  alt: "caption",
  src: "a.png",
  max: maxNone,
  align: alignLeft,
  hideCaption: false,
  ...over,
});

function spy() {
  const calls: Array<[string, unknown]> = [];
  const actions: KasimovImageActions = {
    setWidth: (w) => calls.push(["setWidth", w]),
    setHeight: (h) => calls.push(["setHeight", h]),
    setAlign: (a) => calls.push(["setAlign", a]),
    setHideCaption: (h) => calls.push(["setHideCaption", h]),
    remove: () => calls.push(["remove", null]),
  };
  return { calls, actions };
}

/** A clock the test winds by hand — the pure module never reaches for a real one. */
function clock() {
  let pending: Array<{ fn: () => void; ms: number } | null> = [];
  const schedule: Schedule = (fn, ms) => {
    const slot = pending.length;
    pending.push({ fn, ms });
    return () => {
      pending[slot] = null;
    };
  };
  return {
    schedule,
    /** Fires everything still standing, as one tick. */
    tick: () => {
      const due = pending;
      pending = [];
      due.forEach((p) => p?.fn());
    },
    waiting: () => pending.filter((p) => p !== null).length,
    delays: () => pending.filter((p) => p !== null).map((p) => (p as { ms: number }).ms),
  };
}

const menuOf = (image: KasimovImage, actions: KasimovImageActions, sch: Schedule) =>
  imageMenuSpec(image, actions, sch);
// The spec is a MenuItem union; tests reach into the item they are about.
const itemAt = (menu: { spec: { items: unknown[] } }, i: number) =>
  menu.spec.items[i] as Record<string, unknown>;

describe("widthOfMax", () => {
  const cases: Array<[KasimovMax, number]> = [
    [{ tag: "none" }, 0],
    [{ tag: "w", w: 600 }, 600],
    [{ tag: "wh", w: 480, h: 200 }, 480],
    [{ tag: "h", h: 200 }, 0],
  ];
  it.each(cases)("%o gives %i", (max, width) => {
    expect(widthOfMax(max)).toBe(width);
  });

  // The slider hands a number to the engine and reads a number back out of what
  // the engine made of it; the two have to be the same number, whatever cap the
  // picture carried before.
  it("a width set on any cap reads back as itself", () => {
    const anyMax = fc.oneof(
      fc.constant<KasimovMax>({ tag: "none" }),
      fc.integer({ min: 1, max: 4000 }).map<KasimovMax>((w) => ({ tag: "w", w })),
      fc.integer({ min: 1, max: 4000 }).map<KasimovMax>((h) => ({ tag: "h", h })),
      fc
        .tuple(fc.integer({ min: 1, max: 4000 }), fc.integer({ min: 1, max: 4000 }))
        .map<KasimovMax>(([w, h]) => ({ tag: "wh", w, h })),
    );
    fc.assert(
      fc.property(anyMax, fc.integer({ min: 1, max: MAX_WIDTH }), (max, w) => {
        expect(widthOfMax(withMaxWidth(max, w))).toBe(w);
      }),
    );
    fc.assert(
      fc.property(anyMax, (max) => {
        expect(widthOfMax(withMaxWidth(max, 0))).toBe(0);
      }),
    );
  });
});

describe("trailing", () => {
  it("three calls in a row run once, with the last argument", () => {
    const c = clock();
    const seen: number[] = [];
    const t = trailing(c.schedule, 100, (n: number) => seen.push(n));
    t.run(1);
    t.run(2);
    t.run(3);
    expect(seen).toEqual([]);
    c.tick();
    expect(seen).toEqual([3]);
  });

  it("only one call is ever standing", () => {
    const c = clock();
    const t = trailing(c.schedule, 100, () => {});
    t.run(1);
    t.run(2);
    expect(c.waiting()).toBe(1);
  });

  // A pending call carries an edit into a document, and the editor it would
  // edit can be gone by the time it lands.
  it("a cancelled call never runs", () => {
    const c = clock();
    const seen: number[] = [];
    const t = trailing(c.schedule, 100, (n: number) => seen.push(n));
    t.run(1);
    t.cancel();
    c.tick();
    expect(seen).toEqual([]);
  });

  it("cancelling with nothing pending does nothing, and running after it still works", () => {
    const c = clock();
    const seen: number[] = [];
    const t = trailing(c.schedule, 100, (n: number) => seen.push(n));
    t.cancel();
    t.run(7);
    c.tick();
    expect(seen).toEqual([7]);
  });
});

describe("imageMenuSpec", () => {
  it("the alignment segment stands on the picture's own alignment", () => {
    const { actions } = spy();
    const c = clock();
    expect(itemAt(menuOf(picture({ align: alignLeft }), actions, c.schedule), 0).current).toBe(0);
    expect(itemAt(menuOf(picture({ align: alignCenter }), actions, c.schedule), 0).current).toBe(1);
    expect(itemAt(menuOf(picture({ align: alignRight }), actions, c.schedule), 0).current).toBe(2);
  });

  it("choosing an alignment hands the engine that alignment", () => {
    const { calls, actions } = spy();
    const segment = itemAt(menuOf(picture(), actions, clock().schedule), 0);
    (segment.onSelect as (i: number) => void)(2);
    expect(calls).toEqual([["setAlign", alignRight]]);
  });

  it("the width slider stands on the picture's width cap", () => {
    const { actions } = spy();
    const c = clock();
    expect(itemAt(menuOf(picture({ max: { tag: "w", w: 600 } }), actions, c.schedule), 1).value).toBe(600);
    expect(itemAt(menuOf(picture(), actions, c.schedule), 1).value).toBe(0);
  });

  it("dragging the width slider reaches the engine once the drag stops", () => {
    const c = clock();
    const { calls, actions } = spy();
    const onInput = itemAt(menuOf(picture(), actions, c.schedule), 1).onInput as (w: number) => void;
    onInput(200);
    onInput(400);
    expect(calls).toEqual([]);
    expect(c.delays()).toEqual([WIDTH_DELAY_MS]);
    c.tick();
    expect(calls).toEqual([["setWidth", 400]]);
  });

  it("the menu hands back the way to drop a width it has not delivered", () => {
    const c = clock();
    const { calls, actions } = spy();
    const menu = menuOf(picture(), actions, c.schedule);
    (itemAt(menu, 1).onInput as (w: number) => void)(400);
    menu.cancel();
    c.tick();
    expect(calls).toEqual([]);
  });

  it("the caption switch stands on hideCaption and hands back the flipped value", () => {
    const { calls, actions } = spy();
    const c = clock();
    const off = itemAt(menuOf(picture({ hideCaption: false }), actions, c.schedule), 2);
    expect(off.value).toBe(false);
    (off.onSelect as (on: boolean) => void)(true);
    expect(itemAt(menuOf(picture({ hideCaption: true }), actions, c.schedule), 2).value).toBe(true);
    expect(calls).toEqual([["setHideCaption", true]]);
  });

  it("Delete removes the picture", () => {
    const { calls, actions } = spy();
    const remove = itemAt(menuOf(picture(), actions, clock().schedule), 3);
    expect(remove.label).toBe("Delete");
    (remove.onSelect as () => void)();
    expect(calls).toEqual([["remove", null]]);
  });
});
