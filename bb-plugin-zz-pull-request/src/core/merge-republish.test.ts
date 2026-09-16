import { describe, expect, it } from "vitest";
import { schedulesCatchupBurst } from "./merge-republish";

describe("schedulesCatchupBurst", () => {
  it("no self-update pending → the burst is allowed, the front end needs the catch-up nudges", () => {
    expect(schedulesCatchupBurst({ pendingSelfUpdate: null })).toBe(true);
  });

  it("a self-update is pending → no burst, its timers would fire on a disposed handle", () => {
    expect(schedulesCatchupBurst({ pendingSelfUpdate: "zz-pull-request" })).toBe(false);
  });
});
