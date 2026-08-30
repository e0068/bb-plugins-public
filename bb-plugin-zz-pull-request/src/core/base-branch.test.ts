import { describe, expect, it } from "vitest";
import { resolveBase } from "./base-branch";

describe("resolveBase", () => {
  it("mergeBaseBranch приоритетнее всего; статус — против origin/<x>", () => {
    expect(
      resolveBase({
        mergeBaseBranch: "release",
        defaultBranch: "main",
        baseBranch: "origin/dev",
      }),
    ).toEqual({ statusBase: "origin/release", githubBase: "release" });
  });

  it("нет mergeBaseBranch — берём defaultBranch, статус ремоутный", () => {
    expect(
      resolveBase({ mergeBaseBranch: null, defaultBranch: "main", baseBranch: "origin/dev" }),
    ).toEqual({ statusBase: "origin/main", githubBase: "main" });
  });

  it("остался только baseBranch=origin/main — статус origin/main, github main", () => {
    expect(
      resolveBase({ mergeBaseBranch: null, defaultBranch: null, baseBranch: "origin/main" }),
    ).toEqual({ statusBase: "origin/main", githubBase: "main" });
  });

  it("уже ремоутный baseBranch не удваивает origin/", () => {
    expect(
      resolveBase({ mergeBaseBranch: null, defaultBranch: null, baseBranch: "origin/feature/x" }),
    ).toEqual({ statusBase: "origin/feature/x", githubBase: "feature/x" });
  });

  it("локальное имя с «/» ремоут-квалифицируется целиком", () => {
    expect(
      resolveBase({ mergeBaseBranch: "feature/x", defaultBranch: null, baseBranch: null }),
    ).toEqual({ statusBase: "origin/feature/x", githubBase: "feature/x" });
  });

  it("ничего нет — null", () => {
    expect(
      resolveBase({ mergeBaseBranch: null, defaultBranch: null, baseBranch: null }),
    ).toBeNull();
  });
});
