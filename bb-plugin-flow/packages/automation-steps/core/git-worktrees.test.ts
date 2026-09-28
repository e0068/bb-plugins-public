import { describe, expect, it } from "vitest";
import { findBaseCheckout, parseWorktreeList } from "./git-worktrees";

const PORCELAIN_SAMPLE = [
  "worktree /Users/e0068/Documents/Projects/Kasimov",
  "HEAD 94e633dabc",
  "branch refs/heads/main",
  "",
  "worktree /Users/e0068/.bb/worktrees/env_gv72mszhtn/Kasimov",
  "HEAD c0f55e2abc",
  "branch refs/heads/bb/thr_fmj9w8m7nt",
  "",
  "worktree /Users/e0068/.bb/worktrees/env_detached/Kasimov",
  "HEAD deadbeef",
  "detached",
  "",
].join("\n");

describe("parseWorktreeList", () => {
  it("parses several worktree blocks with regular branches", () => {
    expect(parseWorktreeList(PORCELAIN_SAMPLE)).toEqual([
      { path: "/Users/e0068/Documents/Projects/Kasimov", branch: "refs/heads/main" },
      {
        path: "/Users/e0068/.bb/worktrees/env_gv72mszhtn/Kasimov",
        branch: "refs/heads/bb/thr_fmj9w8m7nt",
      },
      { path: "/Users/e0068/.bb/worktrees/env_detached/Kasimov", branch: null },
    ]);
  });

  it("empty output → empty list", () => {
    expect(parseWorktreeList("")).toEqual([]);
  });

  it("a single worktree with no trailing blank line still parses", () => {
    expect(
      parseWorktreeList("worktree /repo\nHEAD abc\nbranch refs/heads/main"),
    ).toEqual([{ path: "/repo", branch: "refs/heads/main" }]);
  });
});

describe("findBaseCheckout", () => {
  const worktrees = parseWorktreeList(PORCELAIN_SAMPLE);

  it("finds the worktree path where the base is checked out", () => {
    expect(findBaseCheckout(worktrees, "main")).toBe(
      "/Users/e0068/Documents/Projects/Kasimov",
    );
  });

  it("base is not checked out anywhere → null", () => {
    expect(findBaseCheckout(worktrees, "release/1.2")).toBeNull();
  });

  it("a detached worktree does not count as a branch checkout", () => {
    expect(findBaseCheckout(worktrees, "")).toBeNull();
  });
});
