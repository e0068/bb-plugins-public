import { describe, expect, it } from "vitest";
import { isDeletion, type GitFileStatus } from "./changed-files";

describe("isDeletion", () => {
  it("D — deletion", () => {
    expect(isDeletion("D")).toBe(true);
  });

  it("everything else — not a deletion (upsert)", () => {
    const others: GitFileStatus[] = ["?", "??", "A", "C", "M", "R", "U"];
    for (const status of others) expect(isDeletion(status)).toBe(false);
  });
});
