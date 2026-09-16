import { describe, expect, it } from "vitest";
import { bbReportsGitFacts, decideWakeUpVisible, type EnvironmentStatus } from "./retiring";

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

describe("bbReportsGitFacts", () => {
  it("only a ready environment gets an answer out of bb", () => {
    expect(bbReportsGitFacts("ready")).toBe(true);
  });

  it.each<EnvironmentStatus>(["destroyed", "destroying", "error", "provisioning", "retiring"])(
    "%s → bb refuses, the plugin must measure locally",
    (status) => {
      expect(bbReportsGitFacts(status)).toBe(false);
    },
  );
});
