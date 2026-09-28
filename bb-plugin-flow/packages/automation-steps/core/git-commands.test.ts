import { describe, expect, it } from "vitest";
import {
  aheadCountArgs,
  baseTreeArgs,
  headShaArgs,
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

  it("aheadCountArgs — rev-list --count of HEAD's commits ahead of the ref", () => {
    expect(aheadCountArgs("origin/main")).toEqual(["rev-list", "--count", "origin/main..HEAD"]);
  });

  it("aheadCountArgs — a bare local ref (base mode: local) is used as is", () => {
    expect(aheadCountArgs("main")).toEqual(["rev-list", "--count", "main..HEAD"]);
  });

  it("fastForwardArgs — merge --ff-only onto the ref", () => {
    expect(fastForwardArgs("origin/main")).toEqual(["merge", "--ff-only", "origin/main"]);
  });

  it("fastForwardArgs — a bare local ref (base mode: local) is used as is", () => {
    expect(fastForwardArgs("main")).toEqual(["merge", "--ff-only", "main"]);
  });

  it("a ref with a slash is kept as is", () => {
    expect(fastForwardArgs("origin/release/1.2")).toEqual([
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

  it("mergeTreeArgs — merge HEAD into the ref without a working copy", () => {
    expect(mergeTreeArgs("origin/main")).toEqual([
      "merge-tree",
      "--write-tree",
      "origin/main",
      "HEAD",
    ]);
  });

  it("mergeTreeArgs — a bare local ref (base mode: local) is used as is", () => {
    expect(mergeTreeArgs("main")).toEqual(["merge-tree", "--write-tree", "main", "HEAD"]);
  });

  it("baseTreeArgs — rev-parse of the base ref's own tree", () => {
    expect(baseTreeArgs("origin/main")).toEqual(["rev-parse", "origin/main^{tree}"]);
  });

  it("baseTreeArgs — a bare local ref (base mode: local) is used as is", () => {
    expect(baseTreeArgs("main")).toEqual(["rev-parse", "main^{tree}"]);
  });

  it("headShaArgs — the local HEAD, asked without a base and without the network", () => {
    expect(headShaArgs()).toEqual(["rev-parse", "HEAD"]);
  });

  it("a ref with a slash is kept as is in the content commands too", () => {
    expect(mergeTreeArgs("origin/release/1.2")).toEqual([
      "merge-tree",
      "--write-tree",
      "origin/release/1.2",
      "HEAD",
    ]);
    expect(baseTreeArgs("origin/release/1.2")).toEqual(["rev-parse", "origin/release/1.2^{tree}"]);
  });
});
