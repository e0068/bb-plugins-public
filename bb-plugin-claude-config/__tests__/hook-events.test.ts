import { describe, expect, it } from "vitest";
import { HOOK_EVENTS, matcherHint, supportsMatcher } from "../src/hook-events";

describe("HOOK_EVENTS", () => {
  it("names every event once, and hints only where a matcher exists", () => {
    const names = HOOK_EVENTS.map((entry) => entry.event);
    expect(new Set(names).size).toBe(names.length);
    for (const entry of HOOK_EVENTS) {
      expect(entry.event.trim()).toBe(entry.event);
      expect(entry.matcherHint === null).toBe(!entry.matcher);
    }
  });

  it("carries the events the panel is most often used for", () => {
    const names = HOOK_EVENTS.map((entry) => entry.event);
    for (const expected of ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop"]) {
      expect(names).toContain(expected);
    }
  });
});

describe("supportsMatcher / matcherHint", () => {
  it("follow the catalog for known events", () => {
    expect(supportsMatcher("PreToolUse")).toBe(true);
    expect(matcherHint("PreToolUse")).toBeTruthy();
    expect(supportsMatcher("Stop")).toBe(false);
    expect(matcherHint("Stop")).toBeNull();
  });

  it("an unknown event keeps the matcher available", () => {
    // The catalog is a copy of the docs and will lag behind a new event;
    // lagging must not take the field away from a hook that needs it.
    expect(supportsMatcher("SomeFutureEvent")).toBe(true);
    expect(matcherHint("SomeFutureEvent")).toBeNull();
  });
});
