import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { threadChangeTouchesPr } from "./thread-change";

// The other kinds of thread change from the bb contract — everything except environment-changed.
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
  it("environment-changed → touches the PR", () => {
    expect(threadChangeTouchesPr(["environment-changed"])).toBe(true);
  });

  it("heartbeat kinds on their own don't touch the PR", () => {
    expect(threadChangeTouchesPr(irrelevant)).toBe(false);
  });

  it("empty change list → doesn't touch", () => {
    expect(threadChangeTouchesPr([])).toBe(false);
  });

  it("environment-changed mixed in anywhere → touches", () => {
    fc.assert(
      fc.property(fc.subarray(irrelevant), fc.array(fc.constantFrom(...irrelevant)), (a, b) => {
        expect(threadChangeTouchesPr([...a, "environment-changed", ...b])).toBe(true);
      }),
    );
  });

  it("no environment-changed in any set of heartbeats → doesn't touch", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...irrelevant)), (changes) => {
        expect(threadChangeTouchesPr(changes)).toBe(false);
      }),
    );
  });
});
