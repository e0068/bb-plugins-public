import { describe, expect, it } from "vitest";
import { decideWakeUpVisible, type EnvironmentStatus } from "./retiring";

const NON_RETIRING_STATUSES: readonly EnvironmentStatus[] = [
  "ready",
  "provisioning",
  "error",
  "destroying",
  "destroyed",
];

describe("decideWakeUpVisible", () => {
  it("retiring → visible", () => {
    expect(decideWakeUpVisible("retiring")).toBe(true);
  });

  it.each(NON_RETIRING_STATUSES)("%s → hidden", (status) => {
    expect(decideWakeUpVisible(status)).toBe(false);
  });
});
