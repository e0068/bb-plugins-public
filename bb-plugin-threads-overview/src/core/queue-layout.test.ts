import { describe, expect, it } from "vitest";
import { queueLayout } from "./queue-layout";

describe("queueLayout", () => {
  it("turns the queue bottom-up on a phone once the setting is on", () => {
    expect(queueLayout(true, true)).toBe("bottom-up");
  });

  it("keeps the queue top-down on a wide screen whatever the setting says", () => {
    expect(queueLayout(true, false)).toBe("top-down");
    expect(queueLayout(false, false)).toBe("top-down");
  });

  it("keeps the queue top-down on a phone while the setting is off, never set or unreadable", () => {
    for (const setting of [false, undefined, "true", 1]) {
      expect(queueLayout(setting, true)).toBe("top-down");
    }
  });
});
