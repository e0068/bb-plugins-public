import { describe, expect, it } from "vitest";
import { isDeletion, type GitFileStatus } from "./changed-files";

describe("isDeletion", () => {
  it("D — удаление", () => {
    expect(isDeletion("D")).toBe(true);
  });

  it("всё прочее — не удаление (upsert)", () => {
    const others: GitFileStatus[] = ["?", "??", "A", "C", "M", "R", "U"];
    for (const status of others) expect(isDeletion(status)).toBe(false);
  });
});
