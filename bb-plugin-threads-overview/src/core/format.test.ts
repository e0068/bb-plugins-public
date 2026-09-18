import { describe, expect, it } from "vitest";
import { formatWaitingSince } from "./format";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatWaitingSince", () => {
  it("shows 'только что' under a minute", () => {
    expect(formatWaitingSince(30_000, 0)).toBe("только что");
  });

  it("shows whole minutes from one minute up to an hour", () => {
    expect(formatWaitingSince(MIN, 0)).toBe("1 мин");
    expect(formatWaitingSince(5 * MIN, 0)).toBe("5 мин");
    expect(formatWaitingSince(59 * MIN, 0)).toBe("59 мин");
  });

  it("shows whole hours from one hour up to a day", () => {
    expect(formatWaitingSince(HOUR, 0)).toBe("1 ч");
    expect(formatWaitingSince(2 * HOUR, 0)).toBe("2 ч");
    expect(formatWaitingSince(23 * HOUR, 0)).toBe("23 ч");
  });

  it("shows whole days from a day up", () => {
    expect(formatWaitingSince(DAY, 0)).toBe("1 дн");
    expect(formatWaitingSince(3 * DAY, 0)).toBe("3 дн");
  });

  it("never goes negative when the timestamp is in the future", () => {
    expect(formatWaitingSince(0, 5 * MIN)).toBe("только что");
  });
});
