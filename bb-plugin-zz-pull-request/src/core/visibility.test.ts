import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { decideVisibility, type PrPresence } from "./visibility";

const presences: PrPresence[] = ["absent", "open", "settled", "unknown"];

describe("decideVisibility", () => {
  it("видна ровно когда чисто, есть коммиты впереди и PR absent", () => {
    expect(
      decideVisibility({
        hasUncommittedChanges: false,
        aheadCount: 3,
        pr: "absent",
        headAlreadyMerged: false,
      }),
    ).toEqual({ visible: true, reason: "ready" });
  });

  it("PR слит/закрыт (settled) + новый коммит впереди → видна снова", () => {
    expect(
      decideVisibility({
        hasUncommittedChanges: false,
        aheadCount: 1,
        pr: "settled",
        headAlreadyMerged: false,
      }),
    ).toEqual({ visible: true, reason: "ready" });
  });

  it("несохранённые правки прячут кнопку", () => {
    expect(
      decideVisibility({
        hasUncommittedChanges: true,
        aheadCount: 3,
        pr: "absent",
        headAlreadyMerged: false,
      }),
    ).toEqual({ visible: false, reason: "dirty" });
  });

  it("нет коммитов впереди — прячет", () => {
    expect(
      decideVisibility({
        hasUncommittedChanges: false,
        aheadCount: 0,
        pr: "absent",
        headAlreadyMerged: false,
      }),
    ).toEqual({ visible: false, reason: "nothing-to-pr" });
  });

  it("живой PR (open) — прячет, чем бы ни было остальное", () => {
    expect(
      decideVisibility({
        hasUncommittedChanges: false,
        aheadCount: 5,
        pr: "open",
        headAlreadyMerged: false,
      }),
    ).toEqual({ visible: false, reason: "pr-exists" });
  });

  it("статус PR неизвестен — прячет", () => {
    expect(
      decideVisibility({
        hasUncommittedChanges: false,
        aheadCount: 5,
        pr: "unknown",
        headAlreadyMerged: false,
      }),
    ).toEqual({ visible: false, reason: "pr-unknown" });
  });

  it("HEAD уже смёржен нами же — прячет, даже если aheadCount > 0 (squash оставил старые SHA)", () => {
    expect(
      decideVisibility({
        hasUncommittedChanges: false,
        aheadCount: 8,
        pr: "settled",
        headAlreadyMerged: true,
      }),
    ).toEqual({ visible: false, reason: "already-merged" });
  });

  it("инвариант: видна ⇒ чисто ∧ ahead>0 ∧ pr∈{absent,settled} ∧ HEAD не наш смёрженный", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.integer({ min: -2, max: 50 }),
        fc.constantFrom(...presences),
        fc.boolean(),
        (hasUncommittedChanges, aheadCount, pr, headAlreadyMerged) => {
          const { visible } = decideVisibility({
            hasUncommittedChanges,
            aheadCount,
            pr,
            headAlreadyMerged,
          });
          if (visible) {
            expect(hasUncommittedChanges).toBe(false);
            expect(aheadCount).toBeGreaterThan(0);
            expect(pr === "absent" || pr === "settled").toBe(true);
            expect(headAlreadyMerged).toBe(false);
          }
        },
      ),
    );
  });
});
