import { describe, expect, it } from "vitest";
import { isBaseMode, resolveBase } from "./base-branch";

describe("resolveBase — mode origin (status against the remote)", () => {
  it("mergeBaseBranch takes priority over everything; status is against origin/<x>", () => {
    expect(
      resolveBase(
        { mergeBaseBranch: "release", defaultBranch: "main", baseBranch: "origin/dev" },
        "origin",
      ),
    ).toEqual({ mode: "origin", statusBase: "origin/release", githubBase: "release" });
  });

  it("no mergeBaseBranch — falls back to defaultBranch, status is remote", () => {
    expect(
      resolveBase(
        { mergeBaseBranch: null, defaultBranch: "main", baseBranch: "origin/dev" },
        "origin",
      ),
    ).toEqual({ mode: "origin", statusBase: "origin/main", githubBase: "main" });
  });

  it("only baseBranch=origin/main is left — status origin/main, github main", () => {
    expect(
      resolveBase({ mergeBaseBranch: null, defaultBranch: null, baseBranch: "origin/main" }, "origin"),
    ).toEqual({ mode: "origin", statusBase: "origin/main", githubBase: "main" });
  });

  it("an already-remote baseBranch does not double the origin/ prefix", () => {
    expect(
      resolveBase(
        { mergeBaseBranch: null, defaultBranch: null, baseBranch: "origin/feature/x" },
        "origin",
      ),
    ).toEqual({ mode: "origin", statusBase: "origin/feature/x", githubBase: "feature/x" });
  });

  it("a local name with \"/\" is remote-qualified as a whole", () => {
    expect(
      resolveBase({ mergeBaseBranch: "feature/x", defaultBranch: null, baseBranch: null }, "origin"),
    ).toEqual({ mode: "origin", statusBase: "origin/feature/x", githubBase: "feature/x" });
  });
});

describe("resolveBase — mode local (status against the local ref, no origin/ prefix)", () => {
  it("mergeBaseBranch takes priority; status is the bare local name", () => {
    expect(
      resolveBase(
        { mergeBaseBranch: "release", defaultBranch: "main", baseBranch: "origin/dev" },
        "local",
      ),
    ).toEqual({ mode: "local", statusBase: "release", githubBase: "release" });
  });

  it("only baseBranch=origin/main is left — githubBase strips the prefix either way", () => {
    expect(
      resolveBase({ mergeBaseBranch: null, defaultBranch: null, baseBranch: "origin/main" }, "local"),
    ).toEqual({ mode: "local", statusBase: "main", githubBase: "main" });
  });

  it("a name with \"/\" stays bare, not remote-qualified", () => {
    expect(
      resolveBase({ mergeBaseBranch: "feature/x", defaultBranch: null, baseBranch: null }, "local"),
    ).toEqual({ mode: "local", statusBase: "feature/x", githubBase: "feature/x" });
  });
});

describe("resolveBase — nothing set", () => {
  it("null regardless of mode", () => {
    expect(
      resolveBase({ mergeBaseBranch: null, defaultBranch: null, baseBranch: null }, "origin"),
    ).toBeNull();
    expect(
      resolveBase({ mergeBaseBranch: null, defaultBranch: null, baseBranch: null }, "local"),
    ).toBeNull();
  });
});

describe("isBaseMode", () => {
  it("accepts exactly the two known modes", () => {
    expect(isBaseMode("origin")).toBe(true);
    expect(isBaseMode("local")).toBe(true);
  });

  it("rejects anything else, including a stale/foreign KV value", () => {
    expect(isBaseMode("remote")).toBe(false);
    expect(isBaseMode(null)).toBe(false);
    expect(isBaseMode(undefined)).toBe(false);
    expect(isBaseMode(1)).toBe(false);
  });
});
