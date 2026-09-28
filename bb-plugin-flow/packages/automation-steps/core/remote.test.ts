import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseGithubRemote } from "./remote";

// Generator for a valid owner/repo segment: letters/digits/._- , non-empty.
const segment = fc
  .stringMatching(/^[A-Za-z0-9._-]{1,20}$/)
  .filter((s) => s.length > 0);

// All github-remote forms for a single owner/repo pair — round-tripping
// through them must return the original pair.
function remoteForms(owner: string, repo: string): string[] {
  return [
    `git@github.com:${owner}/${repo}.git`,
    `git@github.com:${owner}/${repo}`,
    `https://github.com/${owner}/${repo}.git`,
    `https://github.com/${owner}/${repo}`,
    `https://user@github.com/${owner}/${repo}.git`,
    `ssh://git@github.com/${owner}/${repo}.git`,
  ];
}

describe("parseGithubRemote", () => {
  it("round-trip: any form of any valid pair parses back", () => {
    fc.assert(
      fc.property(segment, segment, (owner, repo) => {
        for (const url of remoteForms(owner, repo)) {
          expect(parseGithubRemote(url)).toEqual({ owner, repo });
        }
      }),
    );
  });

  it("ignores surrounding whitespace", () => {
    expect(parseGithubRemote("  git@github.com:a/b.git \n")).toEqual({
      owner: "a",
      repo: "b",
    });
  });

  it("non-github.com host → null", () => {
    expect(parseGithubRemote("git@gitlab.com:a/b.git")).toBeNull();
    expect(parseGithubRemote("https://example.com/a/b")).toBeNull();
  });

  it("garbage and an incomplete path → null", () => {
    expect(parseGithubRemote("")).toBeNull();
    expect(parseGithubRemote("not a url")).toBeNull();
    expect(parseGithubRemote("https://github.com/onlyowner")).toBeNull();
  });
});
