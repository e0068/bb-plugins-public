import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { isOpBusyMessage, nextBusyThreads, type OpBusyMessage } from "./op-busy";

describe("isOpBusyMessage", () => {
  it("accepts a message with both fields", () => {
    expect(isOpBusyMessage({ threadId: "thr_1", busy: true })).toBe(true);
    expect(isOpBusyMessage({ threadId: "thr_1", busy: false })).toBe(true);
  });

  it("rejects anything missing a field or of the wrong type", () => {
    expect(isOpBusyMessage(null)).toBe(false);
    expect(isOpBusyMessage(undefined)).toBe(false);
    expect(isOpBusyMessage("thr_1")).toBe(false);
    expect(isOpBusyMessage({ threadId: "thr_1" })).toBe(false);
    expect(isOpBusyMessage({ busy: true })).toBe(false);
    expect(isOpBusyMessage({ threadId: 1, busy: true })).toBe(false);
    expect(isOpBusyMessage({ threadId: "thr_1", busy: "yes" })).toBe(false);
  });
});

describe("nextBusyThreads", () => {
  it("busy adds the thread", () => {
    expect([...nextBusyThreads(new Set(), { threadId: "thr_1", busy: true })]).toEqual(["thr_1"]);
  });

  it("idle removes the thread", () => {
    expect([...nextBusyThreads(new Set(["thr_1"]), { threadId: "thr_1", busy: false })]).toEqual([]);
  });

  it("removing a thread that was never busy is a no-op set", () => {
    expect([...nextBusyThreads(new Set(["thr_1"]), { threadId: "thr_2", busy: false })]).toEqual([
      "thr_1",
    ]);
  });

  it("never mutates the previous set", () => {
    const prev = new Set(["thr_1"]);
    nextBusyThreads(prev, { threadId: "thr_2", busy: true });
    expect([...prev]).toEqual(["thr_1"]);
  });

  it("property: membership after a fold equals the message's busy for its thread", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string(), { maxLength: 8 }),
        fc.record({ threadId: fc.string(), busy: fc.boolean() }),
        (initial, message: OpBusyMessage) => {
          const result = nextBusyThreads(new Set(initial), message);
          expect(result.has(message.threadId)).toBe(message.busy);
        },
      ),
    );
  });

  it("property: no other thread's membership changes", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string(), { maxLength: 8 }),
        fc.record({ threadId: fc.string(), busy: fc.boolean() }),
        (initial, message: OpBusyMessage) => {
          const before = new Set(initial);
          const after = nextBusyThreads(before, message);
          for (const id of new Set([...before, ...after])) {
            if (id === message.threadId) continue;
            expect(after.has(id)).toBe(before.has(id));
          }
        },
      ),
    );
  });
});
