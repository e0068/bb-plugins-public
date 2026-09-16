import { describe, expect, it } from "vitest";
import { IDLE_PHASE, routeMemoryStep } from "./route-memory";

describe("routeMemoryStep — mount", () => {
  it("no address and something remembered — restore it, record nothing yet", () => {
    const step = routeMemoryStep({
      phase: IDLE_PHASE,
      reason: "mount",
      subPath: "",
      remembered: "p1/src",
    });
    expect(step.restore).toBe("p1/src");
    expect(step.record).toBeUndefined();
    expect(step.phase.pending).toBe("p1/src");
  });

  it("a deep link wins over the memory, and is recorded as the new place", () => {
    const step = routeMemoryStep({
      phase: IDLE_PHASE,
      reason: "mount",
      subPath: "p2/README.md",
      remembered: "p1/src",
    });
    expect(step.restore).toBeNull();
    expect(step.record).toBe("p2/README.md");
  });

  it("no address and nothing remembered — nothing to restore, nothing to record", () => {
    const step = routeMemoryStep({
      phase: IDLE_PHASE,
      reason: "mount",
      subPath: "",
      remembered: null,
    });
    expect(step.restore).toBeNull();
    expect(step.record).toBeNull();
  });
});

describe("routeMemoryStep — a pending restore", () => {
  const pending = routeMemoryStep({
    phase: IDLE_PHASE,
    reason: "mount",
    subPath: "",
    remembered: "p1/src",
  }).phase;

  it("waits: a route that isn't the one asked for is not recorded", () => {
    // This is the render where the panel still shows the empty subPath it
    // mounted with — recording it would erase the memory being restored.
    const step = routeMemoryStep({
      phase: pending,
      reason: "route-change",
      subPath: "",
      remembered: "p1/src",
    });
    expect(step.record).toBeUndefined();
    expect(step.phase.pending).toBe("p1/src");
  });

  it("the restore landing clears the wait without recording it back", () => {
    const step = routeMemoryStep({
      phase: pending,
      reason: "route-change",
      subPath: "p1/src",
      remembered: "p1/src",
    });
    expect(step.record).toBeUndefined();
    expect(step.phase.pending).toBeNull();
  });

  it("after it lands, the user's next route is recorded", () => {
    const landed = routeMemoryStep({
      phase: pending,
      reason: "route-change",
      subPath: "p1/src",
      remembered: "p1/src",
    }).phase;
    const step = routeMemoryStep({
      phase: landed,
      reason: "route-change",
      subPath: "p1/src/app.tsx",
      remembered: "p1/src",
    });
    expect(step.record).toBe("p1/src/app.tsx");
  });
});

describe("routeMemoryStep — route changes", () => {
  const running = { pending: null, started: true };

  it("records where the user went", () => {
    expect(
      routeMemoryStep({
        phase: running,
        reason: "route-change",
        subPath: "p1/src",
        remembered: null,
      }).record,
    ).toBe("p1/src");
  });

  it("closing what was open forgets it — a closed file must not reopen", () => {
    expect(
      routeMemoryStep({
        phase: running,
        reason: "route-change",
        subPath: "",
        remembered: "p1/src",
      }).record,
    ).toBeNull();
  });
});
