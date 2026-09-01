import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { decideFastForward } from "./fast-forward";

describe("decideFastForward", () => {
  it("отстаём, своих коммитов нет, чисто → видна", () => {
    expect(
      decideFastForward({ behindCount: 3, aheadCount: 0, hasUncommittedChanges: false }),
    ).toEqual({ visible: true, reason: "ready" });
  });

  it("не отстаём → скрыта (нечего перематывать)", () => {
    expect(
      decideFastForward({ behindCount: 0, aheadCount: 0, hasUncommittedChanges: false }),
    ).toEqual({ visible: false, reason: "up-to-date" });
  });

  it("свои коммиты впереди при отставании → скрыта (расхождение)", () => {
    expect(
      decideFastForward({ behindCount: 3, aheadCount: 2, hasUncommittedChanges: false }),
    ).toEqual({ visible: false, reason: "diverged" });
  });

  it("несохранённые правки → скрыта, чем бы ни было остальное", () => {
    expect(
      decideFastForward({ behindCount: 3, aheadCount: 0, hasUncommittedChanges: true }),
    ).toEqual({ visible: false, reason: "dirty" });
  });

  it("инвариант: видна ⇒ чисто ∧ behind>0 ∧ ahead=0", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -2, max: 50 }),
        fc.integer({ min: -2, max: 50 }),
        fc.boolean(),
        (behindCount, aheadCount, hasUncommittedChanges) => {
          const { visible } = decideFastForward({
            behindCount,
            aheadCount,
            hasUncommittedChanges,
          });
          if (visible) {
            expect(hasUncommittedChanges).toBe(false);
            expect(behindCount).toBeGreaterThan(0);
            expect(aheadCount).toBeLessThanOrEqual(0);
          }
        },
      ),
    );
  });
});
