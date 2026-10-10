import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { CLOSED, HUG, dragHeight, heightFromStorage, heightToStorage, pinnedByUser, present, release, step, type WindowEvent, type WindowState } from "./core";

const keys = fc.constantFrom("a/1", "a/2", "b/1");
const event: fc.Arbitrary<WindowEvent> = fc.oneof(
  keys.map((key) => ({ kind: "hover", key }) as const),
  fc.constant({ kind: "leave" } as const),
  keys.map((key) => ({ kind: "click", key }) as const),
  keys.map((key) => ({ kind: "closed", key }) as const),
  keys.map((key) => ({ kind: "pin", key }) as const),
  keys.map((key) => ({ kind: "dismissed", key }) as const),
  fc.constant({ kind: "free" } as const),
);
const run = (events: readonly WindowEvent[]): WindowState => events.reduce((state, e) => step(state, e).state, CLOSED);
const PIN_A: readonly WindowEvent[] = [
  { kind: "hover", key: "a/1" },
  { kind: "pin", key: "a/1" },
];

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

  it("a click on a window opened by hover neither pins it nor lets bb toggle it shut", () => {
    const shown = run([{ kind: "hover", key: "a/1" }]);
    expect(step(shown, { kind: "click", key: "a/1" })).toEqual({ state: shown, command: { kind: "none" }, swallowClick: true });
  });

  it("a click on a closed item lets bb open it, shown like a hovered one and not pinned", () => {
    expect(step(CLOSED, { kind: "click", key: "a/1" })).toEqual({
      state: { pinned: null, shown: "a/1" },
      command: { kind: "none" },
      swallowClick: false,
    });
  });

  it("a click on the pinned item neither unpins it nor lets bb toggle it shut", () => {
    const pinned = run(PIN_A);
    expect(step(pinned, { kind: "click", key: "a/1" })).toEqual({ state: pinned, command: { kind: "none" }, swallowClick: true });
  });

  it("no click on an item ever pins it", () => {
    fc.assert(
      fc.property(fc.array(event.filter((e) => e.kind !== "pin")), (events) => {
        expect(run(events).pinned).toBeNull();
      }),
    );
  });

  it("hovering another item over a pinned window shows it, leaving brings the pinned one back", () => {
    const over = run([...PIN_A, { kind: "hover", key: "b/1" }]);
    expect(over).toEqual({ pinned: "a/1", shown: "b/1" });
    expect(step(over, { kind: "leave" })).toEqual({
      state: { pinned: "a/1", shown: "a/1" },
      command: { kind: "open", key: "a/1" },
      swallowClick: false,
    });
  });

  it("clicking a hovered item over a pinned one keeps the pin where it was", () => {
    const over = run([...PIN_A, { kind: "hover", key: "b/1" }]);
    expect(step(over, { kind: "click", key: "b/1" }).state).toEqual({ pinned: "a/1", shown: "b/1" });
  });

  it("the pin in the hovered window's header pins it", () => {
    const shown = run([{ kind: "hover", key: "a/1" }]);
    expect(step(shown, { kind: "pin", key: "a/1" })).toEqual({
      state: { pinned: "a/1", shown: "a/1" },
      command: { kind: "none" },
      swallowClick: false,
    });
  });

  it("the pin of the pinned window unpins it and leaves it shown until the pointer leaves", () => {
    const pinned = run(PIN_A);
    const unpinned = step(pinned, { kind: "pin", key: "a/1" }).state;
    expect(unpinned).toEqual({ pinned: null, shown: "a/1" });
    expect(step(unpinned, { kind: "leave" }).state).toEqual(CLOSED);
  });

  it("the pin of a window that is not shown changes nothing", () => {
    const shown = run([{ kind: "hover", key: "a/1" }]);
    expect(step(shown, { kind: "pin", key: "b/1" })).toEqual({ state: shown, command: { kind: "none" }, swallowClick: false });
  });

  it("bb closing the pinned window keeps the pin, and the window comes back once the footer is free", () => {
    const away = step(run(PIN_A), { kind: "closed", key: "a/1" }).state;
    expect(away).toEqual({ pinned: "a/1", shown: null });
    expect(step(away, { kind: "leave" }).state).toEqual(away);
    expect(step(away, { kind: "free" })).toEqual({ state: { pinned: "a/1", shown: "a/1" }, command: { kind: "open", key: "a/1" }, swallowClick: false });
  });

  it("bb closing a hovered window over the pinned one brings the pinned one back once the footer is free", () => {
    const away = step(run([...PIN_A, { kind: "hover", key: "b/1" }]), { kind: "closed", key: "b/1" }).state;
    expect(away).toEqual({ pinned: "a/1", shown: null });
    expect(step(away, { kind: "free" }).command).toEqual({ kind: "open", key: "a/1" });
  });

  it("a window its plugin dismissed forgets the pin", () => {
    expect(step(run(PIN_A), { kind: "dismissed", key: "a/1" }).state).toEqual(CLOSED);
    const over = run([...PIN_A, { kind: "hover", key: "b/1" }]);
    expect(step(over, { kind: "dismissed", key: "a/1" }).state).toEqual({ pinned: null, shown: "b/1" });
  });

  it("a free footer opens nothing while nothing is pinned or a window is shown", () => {
    expect(step(CLOSED, { kind: "free" })).toEqual({ state: CLOSED, command: { kind: "none" }, swallowClick: false });
    const pinned = run(PIN_A);
    expect(step(pinned, { kind: "free" })).toEqual({ state: pinned, command: { kind: "none" }, swallowClick: false });
  });

  it("only the pin unpins: nothing bb does to the window forgets it", () => {
    fc.assert(
      fc.property(fc.array(event.filter((e) => e.kind !== "pin" && e.kind !== "dismissed")), (events) => {
        expect(run([...PIN_A, ...events]).pinned).toBe("a/1");
      }),
    );
  });

  it("hovering the shown item again and leaving the pinned one change nothing", () => {
    const shown = run([{ kind: "hover", key: "a/1" }]);
    expect(step(shown, { kind: "hover", key: "a/1" })).toEqual({ state: shown, command: { kind: "none" }, swallowClick: false });
    const pinned = run(PIN_A);
    expect(step(pinned, { kind: "leave" })).toEqual({ state: pinned, command: { kind: "none" }, swallowClick: false });
  });

  it("a pinned window is always the shown one once the pointer has left and the footer is free", () => {
    fc.assert(
      fc.property(fc.array(event), (events) => {
        const state = run([...events, { kind: "leave" }, { kind: "free" }]);
        expect(state.shown).toBe(state.pinned);
      }),
    );
  });

  it("a pinned window away from the footer is the one a free footer opens", () => {
    fc.assert(
      fc.property(fc.array(event), (events) => {
        const state = run(events);
        if (state.pinned !== null && state.shown === null) expect(step(state, { kind: "free" }).command).toEqual({ kind: "open", key: state.pinned });
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

describe("present and release", () => {
  const RA = "r/player";

  it("presenting with nothing open shows the window and holds it like a pinned one", () => {
    expect(present(CLOSED, null, RA)).toEqual({
      state: { pinned: RA, shown: RA },
      presented: { key: RA, restore: null },
      command: { kind: "open", key: RA },
    });
  });

  it("presenting over a pinned window remembers it, releasing brings it back", () => {
    const pinned = run(PIN_A);
    const shown = present(pinned, null, RA);
    expect(shown.presented).toEqual({ key: RA, restore: "a/1" });
    expect(release(shown.state, shown.presented, RA)).toEqual({
      state: { pinned: "a/1", shown: "a/1" },
      presented: null,
      command: { kind: "open", key: "a/1" },
    });
  });

  it("releasing with nothing pinned before closes the window", () => {
    const shown = present(CLOSED, null, RA);
    expect(release(shown.state, shown.presented, RA)).toEqual({ state: CLOSED, presented: null, command: { kind: "close", key: RA } });
  });

  it("presenting the shown window again keeps the first remembered pin and opens nothing", () => {
    const first = present(run(PIN_A), null, RA);
    expect(present(first.state, first.presented, RA)).toEqual({ ...first, command: { kind: "none" } });
  });

  it("presenting a window the user pinned changes nothing, and releasing it then keeps the pin", () => {
    const pinned: WindowState = { pinned: RA, shown: RA };
    const shown = present(pinned, null, RA);
    expect(shown).toEqual({ state: pinned, presented: null, command: { kind: "none" } });
    expect(release(pinned, null, RA)).toEqual({ state: pinned, presented: null, command: { kind: "none" } });
  });

  it("presenting the hovered window opens nothing: it is already on screen", () => {
    const hovered = run([{ kind: "hover", key: RA }]);
    expect(present(hovered, null, RA).command).toEqual({ kind: "none" });
  });

  it("a window hovered over the presented one stays when reading ends, and leaving brings back the pin from before", () => {
    const shown = present(run(PIN_A), null, RA);
    const over = step(shown.state, { kind: "hover", key: "b/1" }).state;
    const released = release(over, shown.presented, RA);
    expect(released).toEqual({ state: { pinned: "a/1", shown: "b/1" }, presented: null, command: { kind: "none" } });
    expect(step(released.state, { kind: "leave" }).state).toEqual({ pinned: "a/1", shown: "a/1" });
  });

  it("releasing a presented window dismissed in the meantime changes nothing and forgets it", () => {
    const shown = present(CLOSED, null, RA);
    const closed = step(shown.state, { kind: "dismissed", key: RA }).state;
    expect(release(closed, shown.presented, RA)).toEqual({ state: CLOSED, presented: null, command: { kind: "none" } });
  });

  it("releasing another item than the presented one changes nothing", () => {
    const shown = present(CLOSED, null, RA);
    expect(release(shown.state, shown.presented, "a/1")).toEqual({ ...shown, command: { kind: "none" } });
  });

  it("the presented window stays on screen when the pointer leaves", () => {
    const shown = present(run([{ kind: "hover", key: "b/1" }]), null, RA);
    expect(step(shown.state, { kind: "leave" }).state).toEqual({ pinned: RA, shown: RA });
  });

  it("only the pin in its header pins the presented window for the user", () => {
    const shown = present(CLOSED, null, RA);
    expect(pinnedByUser(shown.state, shown.presented, RA)).toBe(false);
    expect(pinnedByUser(shown.state, null, RA)).toBe(true);
    expect(pinnedByUser(CLOSED, null, RA)).toBe(false);
  });

  it("whatever the user does meanwhile, release never leaves the item pinned unless the user pinned it", () => {
    fc.assert(
      fc.property(fc.array(event), fc.array(event.filter((e) => e.kind !== "pin")), (before, during) => {
        const start = run(before);
        const shown = present(start, null, RA);
        const meanwhile = during.reduce((state, e) => step(state, e).state, shown.state);
        const { state } = release(meanwhile, shown.presented, RA);
        expect(state.pinned).not.toBe(RA);
      }),
    );
  });
});
