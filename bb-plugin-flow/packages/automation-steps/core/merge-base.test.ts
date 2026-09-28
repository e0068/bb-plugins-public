import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseMergeBaseRef } from "./merge-base";

const sha = "d181e887f29b63f7cb054af63f09817518076ea0";

describe("parseMergeBaseRef", () => {
  it("a full sha passes through", () => {
    expect(parseMergeBaseRef(sha)).toBe(sha);
  });

  it("law: every 40-hex sha is accepted unchanged", () => {
    fc.assert(
      fc.property(fc.hexaString({ minLength: 40, maxLength: 40 }), (s) => {
        expect(parseMergeBaseRef(s.toLowerCase())).toBe(s.toLowerCase());
      }),
    );
  });

  it("no ref, a short sha, a branch name, a decorated sha → unknown, not passed on to GitHub", () => {
    expect(parseMergeBaseRef(null)).toBeNull();
    expect(parseMergeBaseRef("d181e88")).toBeNull();
    expect(parseMergeBaseRef("origin/main")).toBeNull();
    expect(parseMergeBaseRef(`${sha}\n`)).toBeNull();
  });
});
