import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { refineWithLiveOpenPr, type PrSignal } from "./open-pr-refinement";
import type { PrPresence } from "./visibility";

const presences: PrPresence[] = ["absent", "open", "settled", "unknown"];

function signal(over: Partial<PrSignal> = {}): PrSignal {
  return {
    presence: "settled",
    url: "https://github.com/e0068/bb-plugins/pull/1",
    number: 1,
    state: "merged",
    checksState: "passing",
    mergeability: "mergeable",
    ...over,
  };
}

describe("refineWithLiveOpenPr", () => {
  it("host already open → returned as-is, found ignored", () => {
    const host = signal({ presence: "open", number: 1 });
    expect(refineWithLiveOpenPr(host, { number: 41, url: "https://x/41" })).toBe(host);
  });

  it("settled + a live PR found → overridden to open with the found PR's number/url", () => {
    const host = signal({ presence: "settled" });
    expect(refineWithLiveOpenPr(host, { number: 41, url: "https://x/41" })).toEqual({
      presence: "open",
      url: "https://x/41",
      number: 41,
      state: "open",
      checksState: "unknown",
      mergeability: "unknown",
    });
  });

  it("unknown + a live PR found → overridden to open the same way", () => {
    const host = signal({ presence: "unknown", url: null, number: null, state: null, checksState: null, mergeability: null });
    expect(refineWithLiveOpenPr(host, { number: 41, url: "https://x/41" }).presence).toBe("open");
  });

  it("nothing found → the host signal stands, whatever it was", () => {
    const host = signal({ presence: "absent" });
    expect(refineWithLiveOpenPr(host, null)).toBe(host);
  });

  it("property: the result is open exactly when the host already said so or a PR was found", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...presences),
        fc.option(fc.record({ number: fc.integer({ min: 1 }), url: fc.webUrl() }), { nil: null }),
        (presence, found) => {
          const refined = refineWithLiveOpenPr(signal({ presence }), found);
          expect(refined.presence === "open").toBe(presence === "open" || found !== null);
        },
      ),
    );
  });

  it("property: a found PR's number/url always win over the host's own, once refined", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...presences.filter((p) => p !== "open")),
        fc.record({ number: fc.integer({ min: 1 }), url: fc.webUrl() }),
        (presence, found) => {
          const refined = refineWithLiveOpenPr(signal({ presence }), found);
          expect(refined).toEqual({
            presence: "open",
            url: found.url,
            number: found.number,
            state: "open",
            checksState: "unknown",
            mergeability: "unknown",
          });
        },
      ),
    );
  });
});
