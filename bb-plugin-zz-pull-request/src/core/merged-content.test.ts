import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  decideMergedContent,
  resolveAlreadyMerged,
  type MergedContent,
} from "./merged-content";

const TREE = "83c99fce74321c0bbe9b3c67361a5c41006f43dd";
const OTHER_TREE = "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d";

const ok = (stdout: string) => ({ code: 0, stdout });

describe("decideMergedContent", () => {
  it("merge result equals the base tree → the content is already in the base", () => {
    expect(
      decideMergedContent({ mergeTree: ok(`${TREE}\n`), baseTree: ok(`${TREE}\n`) }),
    ).toBe("merged");
  });

  it("merge result differs from the base tree → the branch still has its own changes", () => {
    expect(
      decideMergedContent({ mergeTree: ok(`${OTHER_TREE}\n`), baseTree: ok(`${TREE}\n`) }),
    ).toBe("not-merged");
  });

  // `git merge-tree` exits with 1 on a conflict and prints the tree plus the
  // conflict report. A conflict means the sides diverged — that is an answer,
  // not a failure: there is definitely something left to open a PR for.
  it("a conflict (exit 1) is an answer: not merged", () => {
    expect(
      decideMergedContent({
        mergeTree: { code: 1, stdout: `${OTHER_TREE}\n\nAUTO_MERGED src/app.ts\n` },
        baseTree: ok(`${TREE}\n`),
      }),
    ).toBe("not-merged");
  });

  it("a git failure (exit > 1) gives no answer", () => {
    expect(
      decideMergedContent({
        mergeTree: { code: 128, stdout: "" },
        baseTree: ok(`${TREE}\n`),
      }),
    ).toBe("unknown");
  });

  it("the base tree could not be read → no answer", () => {
    expect(
      decideMergedContent({ mergeTree: ok(`${TREE}\n`), baseTree: { code: 128, stdout: "" } }),
    ).toBe("unknown");
  });

  it("empty output is not an answer, even with exit 0", () => {
    expect(decideMergedContent({ mergeTree: ok("   \n"), baseTree: ok(`${TREE}\n`) })).toBe(
      "unknown",
    );
    expect(decideMergedContent({ mergeTree: ok(`${TREE}\n`), baseTree: ok("") })).toBe(
      "unknown",
    );
  });

  it("only the first line matters — the conflict report after it is ignored", () => {
    expect(
      decideMergedContent({
        mergeTree: { code: 1, stdout: `${TREE}\n\nCONFLICT (content): src/app.ts\n` },
        baseTree: ok(`${TREE}\n`),
      }),
    ).toBe("not-merged");
  });

  it("property: with exit 0 on both sides the answer depends only on tree equality", () => {
    fc.assert(
      fc.property(fc.hexaString({ minLength: 40, maxLength: 40 }), fc.boolean(), (sha, same) => {
        const other = sha === OTHER_TREE ? TREE : OTHER_TREE;
        const decision = decideMergedContent({
          mergeTree: ok(`${sha}\n`),
          baseTree: ok(`${same ? sha : other}\n`),
        });
        expect(decision).toBe(same ? "merged" : "not-merged");
      }),
    );
  });
});

describe("resolveAlreadyMerged", () => {
  it("a fact outweighs the cache in both directions", () => {
    expect(resolveAlreadyMerged("merged", false)).toBe(true);
    expect(resolveAlreadyMerged("not-merged", true)).toBe(false);
  });

  it("without a fact the cached HEAD decides", () => {
    expect(resolveAlreadyMerged("unknown", true)).toBe(true);
    expect(resolveAlreadyMerged("unknown", false)).toBe(false);
  });

  it("property: the cache is consulted only for `unknown`", () => {
    const contents: MergedContent[] = ["merged", "not-merged", "unknown"];
    fc.assert(
      fc.property(fc.constantFrom(...contents), (content) => {
        const withCache = resolveAlreadyMerged(content, true);
        const withoutCache = resolveAlreadyMerged(content, false);
        expect(withCache === withoutCache).toBe(content !== "unknown");
      }),
    );
  });
});
