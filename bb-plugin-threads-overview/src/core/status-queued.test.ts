// A thread whose message waits in the host's queue (bb 0.48), read from the
// row's `queuedWork`, not from `indicator`: the host puts only the highest
// priority state into `indicator`, so a dev server or an unread reply hides the
// queue there. "waiting" holds a Concurrency limit slot and counts as work,
// "failed" is something the user must look at.
import { describe, expect, it } from "vitest";
import { rowStatus, showsWaitingTime, type StatusFacts } from "./status";

function facts(over: Partial<StatusFacts> = {}): StatusFacts {
  return { indicator: "none", hasPendingInteraction: false, ...over };
}

describe("rowStatus of a thread whose message waits to send", () => {
  it("shows queued-waiting", () => {
    expect(rowStatus(facts({ queuedWork: "waiting" }))).toBe("queued-waiting");
  });

  it("shows queued-waiting instead of working, though the thread counts as working", () => {
    expect(rowStatus(facts({ queuedWork: "waiting", working: true }))).toBe("queued-waiting");
  });

  it.each(["background-command", "unread-success", "unread-error", "runtime", "none"])(
    "shows queued-waiting whatever the host's %s indicator hides it behind",
    (indicator) => {
      expect(rowStatus(facts({ queuedWork: "waiting", indicator }))).toBe("queued-waiting");
    },
  );

  it("shows queued-waiting over a background command the facts report", () => {
    expect(rowStatus(facts({ queuedWork: "waiting", backgroundCommand: true }))).toBe("queued-waiting");
  });

  it("puts a pending question above a waiting message", () => {
    expect(rowStatus(facts({ queuedWork: "waiting", hasPendingInteraction: true }))).toBe("waiting-for-input");
  });

  it.each(["automation", "action"] as const)("puts a running %s step above a waiting message", (flowRun) => {
    expect(rowStatus(facts({ queuedWork: "waiting", flowRun }))).toBe(flowRun);
  });
});

describe("rowStatus of a thread whose queued message failed", () => {
  it("shows queued-failed", () => {
    expect(rowStatus(facts({ queuedWork: "failed" }))).toBe("queued-failed");
  });

  it.each(["background-command", "unread-success", "unread-error", "none"])(
    "shows queued-failed whatever the host's %s indicator says",
    (indicator) => {
      expect(rowStatus(facts({ queuedWork: "failed", indicator }))).toBe("queued-failed");
    },
  );

  it("shows queued-failed over a background command the facts report", () => {
    expect(rowStatus(facts({ queuedWork: "failed", backgroundCommand: true }))).toBe("queued-failed");
  });

  it("puts a pending question above a failed message", () => {
    expect(rowStatus(facts({ queuedWork: "failed", hasPendingInteraction: true }))).toBe("waiting-for-input");
  });

  it("shows working over a failed message when the thread is working", () => {
    expect(rowStatus(facts({ queuedWork: "failed", working: true }))).toBe("working");
  });

  it.each(["automation", "action"] as const)("puts a running %s step above a failed message", (flowRun) => {
    expect(rowStatus(facts({ queuedWork: "failed", flowRun }))).toBe(flowRun);
  });
});

describe("rowStatus of a thread with no queued message", () => {
  it("reads the indicator as before", () => {
    expect(rowStatus(facts({ queuedWork: "none", indicator: "unread-success" }))).toBe("unread-success");
    expect(rowStatus(facts({ queuedWork: "none", backgroundCommand: true }))).toBe("background-command");
  });

  it.each(["queued-waiting", "queued-failed"])(
    "does not take the host's %s indicator for the queue: the queue is read from queuedWork",
    (indicator) => {
      expect(rowStatus(facts({ indicator }))).toBeNull();
    },
  );
});

describe("showsWaitingTime of the queue states", () => {
  it.each(["queued-waiting", "queued-failed"] as const)("shows the time on a %s row", (status) => {
    expect(showsWaitingTime(status)).toBe(true);
  });
});
