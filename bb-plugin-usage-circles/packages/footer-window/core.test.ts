import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { CLOSED, HUG, dragHeight, heightFromStorage, heightToStorage, step, type WindowEvent, type WindowState } from "./core";

const keys = fc.constantFrom("a/1", "a/2", "b/1");
const event: fc.Arbitrary<WindowEvent> = fc.oneof(
  keys.map((key) => ({ kind: "hover", key }) as const),
  fc.constant({ kind: "leave" } as const),
  keys.map((key) => ({ kind: "click", key }) as const),
  keys.map((key) => ({ kind: "closed", key }) as const),
  keys.map((key) => ({ kind: "clickInside", key }) as const),
);
const run = (events: readonly WindowEvent[]): WindowState => events.reduce((state, e) => step(state, e).state, CLOSED);

describe("step", () => {
  it("hovering an item shows its window", () => {
    expect(step(CLOSED, { kind: "hover", key: "a/1" })).toEqual({
      state: { pinned: null, shown: "a/1" },
      command: { kind: "open", key: "a/1" },
      swallowClick: false,
    });
  });

  it("leaving a hovered window with nothing pinned closes it", () => {
    const shown = run([{ kind: "hover", key: "a/1" }]);
    expect(step(shown, { kind: "leave" })).toEqual({ state: CLOSED, command: { kind: "close", key: "a/1" }, swallowClick: false });
  });

  it("a click on a window opened by hover pins it and keeps bb from toggling it shut", () => {
    const shown = run([{ kind: "hover", key: "a/1" }]);
    expect(step(shown, { kind: "click", key: "a/1" })).toEqual({
      state: { pinned: "a/1", shown: "a/1" },
      command: { kind: "none" },
      swallowClick: true,
    });
  });

  it("a click on a closed item lets bb open it and pins it", () => {
    expect(step(CLOSED, { kind: "click", key: "a/1" })).toEqual({
      state: { pinned: "a/1", shown: "a/1" },
      command: { kind: "none" },
      swallowClick: false,
    });
  });

  it("a second click on the pinned item lets bb close it and unpins", () => {
    const pinned = run([{ kind: "click", key: "a/1" }]);
    expect(step(pinned, { kind: "click", key: "a/1" })).toEqual({ state: CLOSED, command: { kind: "none" }, swallowClick: false });
  });

  it("hovering another item over a pinned window shows it, leaving brings the pinned one back", () => {
    const over = run([{ kind: "click", key: "a/1" }, { kind: "hover", key: "b/1" }]);
    expect(over).toEqual({ pinned: "a/1", shown: "b/1" });
    expect(step(over, { kind: "leave" })).toEqual({
      state: { pinned: "a/1", shown: "a/1" },
      command: { kind: "open", key: "a/1" },
      swallowClick: false,
    });
  });

  it("clicking a hovered item over a pinned one pins the hovered instead", () => {
    const over = run([{ kind: "click", key: "a/1" }, { kind: "hover", key: "b/1" }]);
    expect(step(over, { kind: "click", key: "b/1" }).state).toEqual({ pinned: "b/1", shown: "b/1" });
  });

  it("a click inside the hovered window pins it and leaves the click to the content", () => {
    const shown = run([{ kind: "hover", key: "a/1" }]);
    expect(step(shown, { kind: "clickInside", key: "a/1" })).toEqual({
      state: { pinned: "a/1", shown: "a/1" },
      command: { kind: "none" },
      swallowClick: false,
    });
  });

  it("a click inside a window that is not the shown one changes nothing", () => {
    const shown = run([{ kind: "hover", key: "a/1" }]);
    expect(step(shown, { kind: "clickInside", key: "b/1" })).toEqual({ state: shown, command: { kind: "none" }, swallowClick: false });
  });

  it("bb closing the pinned window unpins it", () => {
    const pinned = run([{ kind: "click", key: "a/1" }]);
    expect(step(pinned, { kind: "closed", key: "a/1" }).state).toEqual(CLOSED);
  });

  it("hovering the shown item again and leaving the pinned one change nothing", () => {
    const shown = run([{ kind: "hover", key: "a/1" }]);
    expect(step(shown, { kind: "hover", key: "a/1" })).toEqual({ state: shown, command: { kind: "none" }, swallowClick: false });
    const pinned = run([{ kind: "click", key: "a/1" }]);
    expect(step(pinned, { kind: "leave" })).toEqual({ state: pinned, command: { kind: "none" }, swallowClick: false });
  });

  it("a pinned window is always the shown one once the pointer has left", () => {
    fc.assert(
      fc.property(fc.array(event), (events) => {
        const state = run([...events, { kind: "leave" }]);
        expect(state.shown).toBe(state.pinned);
      }),
    );
  });

  it("nothing is pinned that is not shown or about to come back", () => {
    fc.assert(
      fc.property(fc.array(event), (events) => {
        const state = run(events);
        if (state.pinned !== null) expect(state.shown).not.toBeNull();
      }),
    );
  });
});

describe("dragHeight", () => {
  it("dragging the top edge up grows the window by the same distance", () => {
    expect(dragHeight({ startPx: 200, startY: 500, y: 450 }, { min: 80, max: 600 })).toBe(250);
  });

  it("stays between the floor and the ceiling", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2000 }), fc.integer({ min: -2000, max: 2000 }), (startPx, dy) => {
        const px = dragHeight({ startPx, startY: 1000, y: 1000 + dy }, { min: 80, max: 600 });
        expect(px).toBeGreaterThanOrEqual(80);
        expect(px).toBeLessThanOrEqual(600);
      }),
    );
  });

  it("a ceiling below the floor yields the floor", () => {
    expect(dragHeight({ startPx: 300, startY: 0, y: 0 }, { min: 80, max: 40 })).toBe(80);
  });
});

describe("stored height", () => {
  it("round-trips a fixed height", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5000 }), (px) => {
        expect(heightFromStorage(heightToStorage({ kind: "fixed", px }))).toEqual({ kind: "fixed", px });
      }),
    );
  });

  it("missing, empty, junk and non-positive values read as hugging the content", () => {
    for (const raw of [null, "", "abc", "0", "-5", "NaN", "Infinity"]) expect(heightFromStorage(raw)).toEqual(HUG);
  });

  it("hugging is stored as nothing", () => {
    expect(heightToStorage(HUG)).toBeNull();
  });
});
