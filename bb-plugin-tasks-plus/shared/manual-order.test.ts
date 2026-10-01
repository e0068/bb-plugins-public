import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { applyOrder, moveInOrder } from "./manual-order";

const item = (id: string, createdAt = "2026-09-01T00:00:00.000Z") => ({ id, createdAt });
const ids = (items: readonly { id: string }[]) => items.map((entry) => entry.id);

/** Distinct ids, so a list of them is a possible saved order. */
const idList = fc.uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), { maxLength: 12 });

describe("applyOrder", () => {
  it("puts the items in the saved order", () => {
    expect(ids(applyOrder([item("a"), item("b"), item("c")], ["c", "a", "b"]))).toEqual(["c", "a", "b"]);
  });

  it("puts items missing from the order first, the newest on top", () => {
    const items = [
      item("old", "2026-09-01T00:00:00.000Z"),
      item("listed"),
      item("new", "2026-09-20T00:00:00.000Z"),
    ];
    expect(ids(applyOrder(items, ["listed"]))).toEqual(["new", "old", "listed"]);
  });

  it("ignores ids of the order that no longer name an item", () => {
    expect(ids(applyOrder([item("a"), item("b")], ["gone", "b", "a"]))).toEqual(["b", "a"]);
  });

  it("returns a permutation of its input", () => {
    fc.assert(
      fc.property(idList, idList, (present, order) => {
        const result = ids(applyOrder(present.map((id) => item(id)), order));
        expect([...result].sort()).toEqual([...present].sort());
      }),
    );
  });
});

describe("moveInOrder", () => {
  it("places the task right before the card that should follow it", () => {
    expect(moveInOrder(["a", "b", "c", "d"], "d", { beforeTaskId: "a", afterTaskId: "b" })).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });

  it("places the task right after its upper neighbour when it drops at the bottom", () => {
    expect(moveInOrder(["a", "b", "c"], "a", { beforeTaskId: "c", afterTaskId: null })).toEqual(["b", "c", "a"]);
  });

  it("puts the task on top when it drops above a first card", () => {
    expect(moveInOrder(["a", "b", "c"], "c", { beforeTaskId: null, afterTaskId: "a" })).toEqual(["c", "a", "b"]);
  });

  it("moves the task to the end when no neighbour is known", () => {
    expect(moveInOrder(["a", "b", "c"], "a", { beforeTaskId: "x", afterTaskId: "y" })).toEqual(["b", "c", "a"]);
  });

  it("keeps the list when the task drops onto its own place", () => {
    expect(moveInOrder(["a", "b", "c"], "b", { beforeTaskId: "a", afterTaskId: "c" })).toEqual(["a", "b", "c"]);
  });

  it("adds a task the list did not hold yet", () => {
    expect(moveInOrder(["a", "b"], "n", { beforeTaskId: "a", afterTaskId: "b" })).toEqual(["a", "n", "b"]);
  });

  it("keeps every other id, each once, and holds the moved task once", () => {
    fc.assert(
      fc.property(idList, fc.string({ minLength: 1, maxLength: 4 }), fc.nat(), fc.nat(), (list, id, i, j) => {
        const pick = (index: number) => (list.length === 0 ? null : list[index % list.length]!);
        const result = moveInOrder(list, id, { beforeTaskId: pick(i), afterTaskId: pick(j) });
        expect(result.filter((entry) => entry === id)).toHaveLength(1);
        expect(result.filter((entry) => entry !== id)).toEqual(list.filter((entry) => entry !== id));
      }),
    );
  });

  it("puts the task directly above its lower neighbour whenever that neighbour is listed", () => {
    fc.assert(
      fc.property(idList, fc.string({ minLength: 1, maxLength: 4 }), fc.nat(), (list, id, j) => {
        const others = list.filter((entry) => entry !== id);
        fc.pre(others.length > 0);
        const after = others[j % others.length]!;
        const result = moveInOrder(list, id, { beforeTaskId: null, afterTaskId: after });
        expect(result[result.indexOf(after) - 1]).toBe(id);
      }),
    );
  });
});
