import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { mergeMoment } from "./pr-helpers";

const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/;
const MINUTE = 60_000;

describe("mergeMoment", () => {
  it("the merge moment is UTC to the minute: seconds drop, the last millisecond of a day stays on that day", () => {
    expect(mergeMoment(new Date("2026-10-01T11:32:45.120Z"))).toBe("2026-10-01T11:32Z");
    expect(mergeMoment(new Date("2026-10-01T23:59:59.999Z"))).toBe("2026-10-01T23:59Z");
    expect(mergeMoment(new Date("2026-10-02T00:00:00.000Z"))).toBe("2026-10-02T00:00Z");
  });

  it("any moment reads back as the same minute — the viewer's browser parses it on its own", () => {
    fc.assert(
      fc.property(fc.date({ min: new Date("2020-01-01"), max: new Date("2099-12-31"), noInvalidDate: true }), (at) => {
        const moment = mergeMoment(at);
        expect(moment).toMatch(MOMENT);
        expect(Date.parse(moment)).toBe(Math.floor(at.getTime() / MINUTE) * MINUTE);
      }),
    );
  });
});
