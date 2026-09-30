// A row whose thread is working right now shows its spinner and no time: the
// time of its last activity would only say "a while ago" about something
// going on at this moment.
import { describe, expect, it } from "vitest";
import { showsWaitingTime, type RowStatus } from "./status";

describe("showsWaitingTime", () => {
  it("shows no time on a working thread", () => {
    expect(showsWaitingTime("working")).toBe(false);
  });

  it("shows the time on every other row", () => {
    const others: readonly (RowStatus | null)[] = [
      null,
      "unread-success",
      "unread-error",
      "waiting-for-input",
      "background-command",
    ];
    for (const status of others) expect(showsWaitingTime(status)).toBe(true);
  });
});
