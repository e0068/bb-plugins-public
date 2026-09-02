import { describe, expect, it } from "vitest";

import { rankCandidates, type Candidate } from "../src/suggest";

describe("rankCandidates", () => {
  it("code-standards matches code-st higher, code-review doesn't match", () => {
    const result = rankCandidates(
      [{ value: "code-review" }, { value: "code-standards" }, { value: "git" }],
      "code-st",
      8,
    );
    expect(result.map((c) => c.value)).toEqual(["code-standards"]);
  });

  it("an exact prefix ranks above a mid-string occurrence", () => {
    const result = rankCandidates(
      [{ value: "my-preflight" }, { value: "preflight" }],
      "pre",
      8,
    );
    expect(result.map((c) => c.value)).toEqual(["preflight", "my-preflight"]);
  });

  it("caps the result at limit", () => {
    const candidates: Candidate[] = [
      { value: "a1" },
      { value: "a2" },
      { value: "a3" },
    ];
    expect(rankCandidates(candidates, "a", 2)).toHaveLength(2);
  });

  it("an empty query returns the first `limit` items in original order, unfiltered", () => {
    const candidates: Candidate[] = [{ value: "z" }, { value: "a" }, { value: "m" }];
    expect(rankCandidates(candidates, "", 2).map((c) => c.value)).toEqual(["z", "a"]);
  });

  it("dedups by value — the first one wins", () => {
    const candidates: Candidate[] = [
      { value: "git", label: "first" },
      { value: "git", label: "second" },
    ];
    const result = rankCandidates(candidates, "git", 8);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("first");
  });

  it("label also participates in matching", () => {
    const candidates: Candidate[] = [
      { value: "id-1", label: "Code Review" },
      { value: "id-2", label: "Git Hygiene" },
    ];
    const result = rankCandidates(candidates, "review", 8);
    expect(result.map((c) => c.value)).toEqual(["id-1"]);
  });

  it("is case-insensitive", () => {
    expect(
      rankCandidates([{ value: "AGENTS.md" }], "agents", 8).map((c) => c.value),
    ).toEqual(["AGENTS.md"]);
  });

  it("a segment prefix ranks between an exact prefix and a substring", () => {
    const result = rankCandidates(
      [
        { value: "barcode" }, // substring (2) — "code" isn't at a segment start
        { value: "code" }, // exact prefix (0)
        { value: "auto-code" }, // segment prefix (1)
      ],
      "code",
      8,
    );
    expect(result.map((c) => c.value)).toEqual(["code", "auto-code", "barcode"]);
  });

  it("nothing matches — empty result", () => {
    expect(rankCandidates([{ value: "git" }], "zzz", 8)).toEqual([]);
  });
});
