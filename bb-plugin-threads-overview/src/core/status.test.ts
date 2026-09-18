import { describe, expect, it } from "vitest";
import { rowStatus, worktreeOf, type StatusFacts } from "./status";

function facts(over: Partial<StatusFacts> = {}): StatusFacts {
  return { indicator: "none", hasPendingInteraction: false, ...over };
}

describe("rowStatus", () => {
  it("a thread with nothing to show has no status", () => {
    expect(rowStatus(facts())).toBeNull();
  });

  it.each([
    ["unread-success", "unread-success"],
    ["unread-error", "unread-error"],
    ["waiting-for-input", "waiting-for-input"],
  ] as const)("the host's %s indicator is shown as %s", (indicator, status) => {
    expect(rowStatus(facts({ indicator }))).toBe(status);
  });

  it("a pending question or approval is waiting for input whatever the indicator says", () => {
    expect(
      rowStatus(facts({ indicator: "unread-success", hasPendingInteraction: true })),
    ).toBe("waiting-for-input");
  });

  it.each(["runtime", "workflow", "goal", "plan-mode", "draft", "working-draft", "something-new"])(
    "the %s indicator is not a row status",
    (indicator) => {
      expect(rowStatus(facts({ indicator }))).toBeNull();
    },
  );
});

describe("worktreeOf", () => {
  const environment = (workspaceDisplayKind: "managed-worktree" | "unmanaged-worktree" | "other", branchName: string | null = "bb/x") => ({
    workspaceDisplayKind,
    branchName,
  });

  it.each(["managed-worktree", "unmanaged-worktree"] as const)("a %s is a worktree on its branch", (kind) => {
    expect(worktreeOf(environment(kind))).toEqual({ branch: "bb/x" });
  });

  it("a worktree whose branch is unknown is still a worktree", () => {
    expect(worktreeOf(environment("managed-worktree", null))).toEqual({ branch: null });
  });

  it("a plain checkout is not a worktree", () => {
    expect(worktreeOf(environment("other"))).toBeNull();
  });

  it("a thread with no environment yet is not in a worktree", () => {
    expect(worktreeOf(null)).toBeNull();
  });
});
