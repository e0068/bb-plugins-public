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
  it("разбирает несколько блоков worktree с обычными ветками", () => {
    expect(parseWorktreeList(PORCELAIN_SAMPLE)).toEqual([
      { path: "/Users/e0068/Documents/Projects/Kasimov", branch: "refs/heads/main" },
      {
        path: "/Users/e0068/.bb/worktrees/env_gv72mszhtn/Kasimov",
        branch: "refs/heads/bb/thr_fmj9w8m7nt",
      },
      { path: "/Users/e0068/.bb/worktrees/env_detached/Kasimov", branch: null },
    ]);
  });

  it("пустой вывод → пустой список", () => {
    expect(parseWorktreeList("")).toEqual([]);
  });

  it("один worktree без завершающей пустой строки всё равно разобран", () => {
    expect(
      parseWorktreeList("worktree /repo\nHEAD abc\nbranch refs/heads/main"),
    ).toEqual([{ path: "/repo", branch: "refs/heads/main" }]);
  });
});

describe("findBaseCheckout", () => {
  const worktrees = parseWorktreeList(PORCELAIN_SAMPLE);

  it("находит путь worktree, где зачекаучена база", () => {
    expect(findBaseCheckout(worktrees, "main")).toBe(
      "/Users/e0068/Documents/Projects/Kasimov",
    );
  });

  it("база нигде не зачекаучена → null", () => {
    expect(findBaseCheckout(worktrees, "release/1.2")).toBeNull();
  });

  it("detached-worktree не считается чекаутом ветки", () => {
    expect(findBaseCheckout(worktrees, "")).toBeNull();
  });
});
