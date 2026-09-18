import { describe, expect, it } from "vitest";
import { composerKeyMove, queueKeyMove } from "./keys";

describe("queueKeyMove", () => {
  it("moves down to the next row", () => {
    expect(queueKeyMove("ArrowDown", 0, 3)).toEqual({ kind: "focus", index: 1 });
  });

  it("stays on the last row when moving down past it", () => {
    expect(queueKeyMove("ArrowDown", 2, 3)).toEqual({ kind: "none" });
  });

  it("moves up to the previous row", () => {
    expect(queueKeyMove("ArrowUp", 2, 3)).toEqual({ kind: "focus", index: 1 });
  });

  it("goes back to the composer when moving up from the first row", () => {
    expect(queueKeyMove("ArrowUp", 0, 3)).toEqual({ kind: "composer" });
  });

  it("goes back to the composer on Escape from any row", () => {
    expect(queueKeyMove("Escape", 1, 3)).toEqual({ kind: "composer" });
  });

  it.each(["Enter", "ArrowRight"])("opens the row on %s", (key) => {
    expect(queueKeyMove(key, 1, 3)).toEqual({ kind: "open" });
  });

  it("leaves every other key alone", () => {
    expect(queueKeyMove("a", 1, 3)).toEqual({ kind: "none" });
    expect(queueKeyMove("ArrowLeft", 1, 3)).toEqual({ kind: "none" });
  });
});

describe("composerKeyMove", () => {
  const facts = {
    key: "ArrowDown",
    modified: false,
    ownComposer: true,
    empty: true,
    caretAtStart: true,
  };

  it("enters the queue on the down arrow in the home screen's empty composer", () => {
    expect(composerKeyMove(facts)).toBe("enter-queue");
  });

  it("leaves the down arrow to a composer holding text, to another pane's composer, and to a modified key", () => {
    expect(composerKeyMove({ ...facts, empty: false })).toBe("none");
    expect(composerKeyMove({ ...facts, ownComposer: false })).toBe("none");
    expect(composerKeyMove({ ...facts, modified: true })).toBe("none");
  });

  it("goes back to the queue on the left arrow at the very start of another pane's composer", () => {
    expect(composerKeyMove({ ...facts, key: "ArrowLeft", ownComposer: false, empty: false })).toBe(
      "back-to-queue",
    );
  });

  it("leaves the left arrow alone away from the start, in the home screen's composer, and with a modifier", () => {
    const left = { ...facts, key: "ArrowLeft", ownComposer: false };
    expect(composerKeyMove({ ...left, caretAtStart: false })).toBe("none");
    expect(composerKeyMove({ ...left, ownComposer: true })).toBe("none");
    expect(composerKeyMove({ ...left, modified: true })).toBe("none");
  });
});
