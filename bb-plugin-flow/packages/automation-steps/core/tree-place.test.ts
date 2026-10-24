import { describe, expect, it } from "vitest";

import { branchOffName, treePlaceOf, type GitPlace } from "./tree-place";

const worktree: GitPlace = { isGitRepo: true, isWorktree: true, managed: true, branchName: "bb/flow-thr_a", defaultBranch: "main" };
const checkout: GitPlace = { isGitRepo: true, isWorktree: false, managed: false, branchName: "main", defaultBranch: "main" };

describe("treePlaceOf", () => {
  it("окружения ещё нет — тред не запущен", () => {
    expect(treePlaceOf(null)).toBe("not-started");
  });

  it("worktree — своё дерево", () => {
    expect(treePlaceOf(worktree)).toBe("own-tree");
  });

  it("чекаут проекта — дерево, которое bb не заводил", () => {
    expect(treePlaceOf(checkout)).toBe("project-checkout");
    expect(treePlaceOf({ ...checkout, branchName: "feature" })).toBe("project-checkout");
  });

  it("папка без git — не дерево git", () => {
    expect(treePlaceOf({ ...checkout, isGitRepo: false })).toBe("no-git");
  });
});

describe("branchOffName", () => {
  it("ветка по умолчанию — отводится bb/flow-<тред>", () => {
    expect(branchOffName(checkout, "thr_x")).toBe("bb/flow-thr_x");
  });

  it("ветка по умолчанию записана с origin/ — та же ветка", () => {
    expect(branchOffName({ ...checkout, defaultBranch: "origin/main" }, "thr_x")).toBe("bb/flow-thr_x");
  });

  it("своя ветка — коммит в неё, отвода нет", () => {
    expect(branchOffName(worktree, "thr_x")).toBeNull();
    expect(branchOffName({ ...checkout, branchName: "feature" }, "thr_x")).toBeNull();
  });

  it("ветка или ветка по умолчанию неизвестны — отвода нет", () => {
    expect(branchOffName({ ...checkout, branchName: null }, "thr_x")).toBeNull();
    expect(branchOffName({ ...checkout, defaultBranch: null }, "thr_x")).toBeNull();
  });
});
