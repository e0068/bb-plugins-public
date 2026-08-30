import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { decideVisibility, type PrLookupOutcome } from "./visibility";

const outcomes: PrLookupOutcome[] = ["absent", "available", "unavailable"];

describe("decideVisibility", () => {
  it("видна ровно когда чисто, есть коммиты впереди и PR absent", () => {
    expect(
      decideVisibility({ hasUncommittedChanges: false, aheadCount: 3, pr: "absent" }),
    ).toEqual({ visible: true, reason: "ready" });
  });

  it("несохранённые правки прячут кнопку", () => {
    expect(
      decideVisibility({ hasUncommittedChanges: true, aheadCount: 3, pr: "absent" }),
    ).toEqual({ visible: false, reason: "dirty" });
  });

  it("нет коммитов впереди — прячет", () => {
    expect(
      decideVisibility({ hasUncommittedChanges: false, aheadCount: 0, pr: "absent" }),
    ).toEqual({ visible: false, reason: "nothing-to-pr" });
  });

  it("PR уже открыт — прячет, чем бы ни было остальное", () => {
    expect(
      decideVisibility({ hasUncommittedChanges: false, aheadCount: 5, pr: "available" }),
    ).toEqual({ visible: false, reason: "pr-exists" });
  });

  it("статус PR неизвестен — прячет", () => {
    expect(
      decideVisibility({ hasUncommittedChanges: false, aheadCount: 5, pr: "unavailable" }),
    ).toEqual({ visible: false, reason: "pr-unknown" });
  });

  it("инвариант: видна ⇒ чисто ∧ ahead>0 ∧ pr=absent", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.integer({ min: -2, max: 50 }),
        fc.constantFrom(...outcomes),
        (hasUncommittedChanges, aheadCount, pr) => {
          const { visible } = decideVisibility({ hasUncommittedChanges, aheadCount, pr });
          if (visible) {
            expect(hasUncommittedChanges).toBe(false);
            expect(aheadCount).toBeGreaterThan(0);
            expect(pr).toBe("absent");
          }
        },
      ),
    );
  });
});
