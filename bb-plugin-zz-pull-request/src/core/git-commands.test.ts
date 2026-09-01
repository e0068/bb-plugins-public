import { describe, expect, it } from "vitest";
import {
  aheadCountArgs,
  fastForwardAtArgs,
  fastForwardArgs,
  fetchBaseAtArgs,
  fetchBaseArgs,
  fetchIntoLocalBranchArgs,
  worktreeListArgs,
} from "./git-commands";

describe("git-commands", () => {
  it("fetchBaseArgs — fetch ремоута с именем базы", () => {
    expect(fetchBaseArgs("main")).toEqual(["fetch", "origin", "main"]);
  });

  it("aheadCountArgs — rev-list --count коммитов HEAD впереди origin/<base>", () => {
    expect(aheadCountArgs("main")).toEqual(["rev-list", "--count", "origin/main..HEAD"]);
  });

  it("fastForwardArgs — merge --ff-only на origin/<base>", () => {
    expect(fastForwardArgs("main")).toEqual(["merge", "--ff-only", "origin/main"]);
  });

  it("имя базы с слэшем сохраняется как есть", () => {
    expect(fastForwardArgs("release/1.2")).toEqual([
      "merge",
      "--ff-only",
      "origin/release/1.2",
    ]);
  });

  it("fetchIntoLocalBranchArgs — fetch origin <base>:<base> без ведущего +", () => {
    expect(fetchIntoLocalBranchArgs("main")).toEqual(["fetch", "origin", "main:main"]);
  });

  it("worktreeListArgs — worktree list --porcelain", () => {
    expect(worktreeListArgs()).toEqual(["worktree", "list", "--porcelain"]);
  });

  it("fetchBaseAtArgs — -C <path> перед fetchBaseArgs", () => {
    expect(fetchBaseAtArgs("/repo/other", "main")).toEqual([
      "-C",
      "/repo/other",
      "fetch",
      "origin",
      "main",
    ]);
  });

  it("fastForwardAtArgs — -C <path> перед fastForwardArgs", () => {
    expect(fastForwardAtArgs("/repo/other", "main")).toEqual([
      "-C",
      "/repo/other",
      "merge",
      "--ff-only",
      "origin/main",
    ]);
  });
});
