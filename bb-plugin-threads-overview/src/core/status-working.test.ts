// A running thread shown in the queue says so on its row.
import { describe, expect, it } from "vitest";
import { rowStatus } from "./status";

describe("rowStatus of a working thread", () => {
  it("shows a working thread as working", () => {
    expect(rowStatus({ indicator: "runtime", hasPendingInteraction: false, working: true })).toBe(
      "working",
    );
  });

  it("shows working over an unread result a background agent is still adding to", () => {
    expect(
      rowStatus({ indicator: "unread-success", hasPendingInteraction: false, working: true }),
    ).toBe("working");
  });

  it("puts a pending question above work", () => {
    expect(rowStatus({ indicator: "runtime", hasPendingInteraction: true, working: true })).toBe(
      "waiting-for-input",
    );
  });

  it("reads the indicator as before for a thread that is not working", () => {
    expect(
      rowStatus({ indicator: "unread-error", hasPendingInteraction: false, working: false }),
    ).toBe("unread-error");
  });
});
