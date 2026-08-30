import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { threadChangeTouchesPr } from "./thread-change";

// Прочие виды изменения треда из контракта bb — все, кроме environment-changed.
const irrelevant = [
  "archived-changed",
  "events-appended",
  "history-rewritten",
  "interactions-changed",
  "order-changed",
  "parent-changed",
  "pin-state-changed",
  "queue-changed",
  "read-state-changed",
  "status-changed",
  "tabs-changed",
  "terminals-changed",
  "thread-created",
  "thread-deleted",
  "title-changed",
];

describe("threadChangeTouchesPr", () => {
  it("environment-changed → задевает PR", () => {
    expect(threadChangeTouchesPr(["environment-changed"])).toBe(true);
  });

  it("виды-хартбиты сами по себе не задевают PR", () => {
    expect(threadChangeTouchesPr(irrelevant)).toBe(false);
  });

  it("пустой список изменений → не задевает", () => {
    expect(threadChangeTouchesPr([])).toBe(false);
  });

  it("environment-changed в любой примеси → задевает", () => {
    fc.assert(
      fc.property(fc.subarray(irrelevant), fc.array(fc.constantFrom(...irrelevant)), (a, b) => {
        expect(threadChangeTouchesPr([...a, "environment-changed", ...b])).toBe(true);
      }),
    );
  });

  it("без environment-changed из любого набора хартбитов → не задевает", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...irrelevant)), (changes) => {
        expect(threadChangeTouchesPr(changes)).toBe(false);
      }),
    );
  });
});
