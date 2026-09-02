import { describe, expect, it } from "vitest";
import { resolveBase } from "./base-branch";

describe("resolveBase", () => {
  it("mergeBaseBranch takes priority over everything; status is against origin/<x>", () => {
    expect(
      resolveBase({
        mergeBaseBranch: "release",
        defaultBranch: "main",
        baseBranch: "origin/dev",
      }),
    ).toEqual({ statusBase: "origin/release", githubBase: "release" });
  });

  it("no mergeBaseBranch — falls back to defaultBranch, status is remote", () => {
    expect(
      resolveBase({ mergeBaseBranch: null, defaultBranch: "main", baseBranch: "origin/dev" }),
    ).toEqual({ statusBase: "origin/main", githubBase: "main" });
  });

  it("only baseBranch=origin/main is left — status origin/main, github main", () => {
    expect(
      resolveBase({ mergeBaseBranch: null, defaultBranch: null, baseBranch: "origin/main" }),
    ).toEqual({ statusBase: "origin/main", githubBase: "main" });
  });

  it("an already-remote baseBranch does not double the origin/ prefix", () => {
    expect(
      resolveBase({ mergeBaseBranch: null, defaultBranch: null, baseBranch: "origin/feature/x" }),
    ).toEqual({ statusBase: "origin/feature/x", githubBase: "feature/x" });
  });

  it("a local name with \"/\" is remote-qualified as a whole", () => {
    expect(
      resolveBase({ mergeBaseBranch: "feature/x", defaultBranch: null, baseBranch: null }),
    ).toEqual({ statusBase: "origin/feature/x", githubBase: "feature/x" });
  });

  it("nothing is set — null", () => {
    expect(
      resolveBase({ mergeBaseBranch: null, defaultBranch: null, baseBranch: null }),
    ).toBeNull();
  });
});
