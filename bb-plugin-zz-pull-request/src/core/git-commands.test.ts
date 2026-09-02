import { describe, expect, it } from "vitest";
import {
  aheadCountArgs,
  baseTreeArgs,
  fastForwardAtArgs,
  fastForwardArgs,
  fetchBaseAtArgs,
  fetchBaseArgs,
  fetchIntoLocalBranchArgs,
  mergeTreeArgs,
  worktreeListArgs,
} from "./git-commands";

describe("git-commands", () => {
  it("fetchBaseArgs — fetch the remote with the base name", () => {
    expect(fetchBaseArgs("main")).toEqual(["fetch", "origin", "main"]);
  });

  it("aheadCountArgs — rev-list --count of HEAD's commits ahead of origin/<base>", () => {
    expect(aheadCountArgs("main")).toEqual(["rev-list", "--count", "origin/main..HEAD"]);
  });

  it("fastForwardArgs — merge --ff-only onto origin/<base>", () => {
    expect(fastForwardArgs("main")).toEqual(["merge", "--ff-only", "origin/main"]);
  });

  it("a base name with a slash is kept as is", () => {
    expect(fastForwardArgs("release/1.2")).toEqual([
      "merge",
      "--ff-only",
      "origin/release/1.2",
    ]);
  });

  it("fetchIntoLocalBranchArgs — fetch origin <base>:<base> with no leading +", () => {
    expect(fetchIntoLocalBranchArgs("main")).toEqual(["fetch", "origin", "main:main"]);
  });

  it("worktreeListArgs — worktree list --porcelain", () => {
    expect(worktreeListArgs()).toEqual(["worktree", "list", "--porcelain"]);
  });

  it("fetchBaseAtArgs — -C <path> before fetchBaseArgs", () => {
    expect(fetchBaseAtArgs("/repo/other", "main")).toEqual([
      "-C",
      "/repo/other",
      "fetch",
      "origin",
      "main",
    ]);
  });

  it("fastForwardAtArgs — -C <path> before fastForwardArgs", () => {
    expect(fastForwardAtArgs("/repo/other", "main")).toEqual([
      "-C",
      "/repo/other",
      "merge",
      "--ff-only",
      "origin/main",
    ]);
  });

  it("mergeTreeArgs — merge HEAD into origin/<base> without a working copy", () => {
    expect(mergeTreeArgs("main")).toEqual([
      "merge-tree",
      "--write-tree",
      "origin/main",
      "HEAD",
    ]);
  });

  it("baseTreeArgs — rev-parse of the base's own tree", () => {
    expect(baseTreeArgs("main")).toEqual(["rev-parse", "origin/main^{tree}"]);
  });

  it("a base name with a slash is kept as is in the content commands too", () => {
    expect(mergeTreeArgs("release/1.2")).toEqual([
      "merge-tree",
      "--write-tree",
      "origin/release/1.2",
      "HEAD",
    ]);
    expect(baseTreeArgs("release/1.2")).toEqual(["rev-parse", "origin/release/1.2^{tree}"]);
  });
});
