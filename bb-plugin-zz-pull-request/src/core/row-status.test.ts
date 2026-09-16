import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { MergedContent } from "./merged-content";
import type { ChecksState, Mergeability, PrState } from "./merge-readiness";
import {
  decideGitPhase,
  decideRowState,
  decideRowStatus,
  isAgentWorking,
  livePrState,
  rowStateToStatus,
  withOpRunning,
  type PrSignal,
  type RowFacts,
  type RowState,
  type RowStatus,
  type ThreadActivity,
} from "./row-status";

const NO_ACTIVITY: ThreadActivity = {
  workflows: 0,
  backgroundAgents: 0,
  backgroundCommands: 0,
  planMode: 0,
  goals: 0,
};

const CHECK_STATES: ChecksState[] = ["failing", "no_checks", "passing", "pending", "unknown"];
const MERGEABILITIES: Mergeability[] = ["conflicting", "mergeable", "unknown"];

function facts(overrides: Partial<RowFacts> = {}): RowFacts {
  return {
    gitPhase: "clean",
    pr: null,
    agentWorking: false,
    mergedSeen: false,
    ...overrides,
  };
}

const arbMergedContent = fc.constantFrom<MergedContent>("merged", "not-merged", "unknown");

describe("decideGitPhase", () => {
  // The plugin opens PRs through the GitHub API without a push, and merges by
  // squash — so a branch whose content landed long ago still reads as "ahead"
  // forever. `mergedContent` is what tells the two apart.
  const ahead = { hasUncommittedChanges: false, aheadCount: 2 } as const;

  it("uncommitted beats everything else", () => {
    expect(
      decideGitPhase({ hasUncommittedChanges: true, aheadCount: 5, mergedContent: "not-merged" }),
    ).toBe("uncommitted");
  });
  it("committed when ahead and clean tree", () => {
    expect(decideGitPhase({ ...ahead, mergedContent: "not-merged" })).toBe("committed");
  });
  it("clean when nothing changed and nothing ahead", () => {
    expect(
      decideGitPhase({ hasUncommittedChanges: false, aheadCount: 0, mergedContent: "not-merged" }),
    ).toBe("clean");
  });

  it("ahead of the base, but the content is already in it → clean, nothing left to merge", () => {
    expect(decideGitPhase({ ...ahead, mergedContent: "merged" })).toBe("clean");
  });

  it("content git could not measure keeps the glyph — silence is not proof of a merge", () => {
    expect(decideGitPhase({ ...ahead, mergedContent: "unknown" })).toBe("committed");
  });

  it("work of one's own outranks a merged content: the tree is dirty again", () => {
    expect(
      decideGitPhase({ hasUncommittedChanges: true, aheadCount: 2, mergedContent: "merged" }),
    ).toBe("uncommitted");
  });

  it("property: a dirty tree is always uncommitted", () => {
    fc.assert(
      fc.property(fc.nat(), arbMergedContent, (aheadCount, mergedContent) => {
        expect(decideGitPhase({ hasUncommittedChanges: true, aheadCount, mergedContent })).toBe(
          "uncommitted",
        );
      }),
    );
  });
  it("property: clean tree splits on aheadCount at zero while the content is not in the base", () => {
    fc.assert(
      fc.property(fc.nat(), fc.constantFrom("not-merged", "unknown"), (aheadCount, mergedContent) => {
        const phase = decideGitPhase({
          hasUncommittedChanges: false,
          aheadCount,
          mergedContent: mergedContent as MergedContent,
        });
        expect(phase).toBe(aheadCount > 0 ? "committed" : "clean");
      }),
    );
  });
  it("property: a clean tree whose content is in the base is clean, however far ahead it reads", () => {
    fc.assert(
      fc.property(fc.nat(), (aheadCount) => {
        expect(decideGitPhase({ hasUncommittedChanges: false, aheadCount, mergedContent: "merged" })).toBe(
          "clean",
        );
      }),
    );
  });
});

describe("isAgentWorking", () => {
  it("all counters zero → not working", () => {
    expect(isAgentWorking(NO_ACTIVITY)).toBe(false);
  });

  const keys: (keyof ThreadActivity)[] = [
    "workflows",
    "backgroundAgents",
    "backgroundCommands",
    "planMode",
    "goals",
  ];
  for (const key of keys) {
    it(`${key} > 0 → working`, () => {
      expect(isAgentWorking({ ...NO_ACTIVITY, [key]: 1 })).toBe(true);
    });
  }

  it("property: working ⇔ some counter positive", () => {
    fc.assert(
      fc.property(
        fc.record({
          workflows: fc.nat(),
          backgroundAgents: fc.nat(),
          backgroundCommands: fc.nat(),
          planMode: fc.nat(),
          goals: fc.nat(),
        }),
        (activity) => {
          const anyPositive = keys.some((k) => activity[k] > 0);
          expect(isAgentWorking(activity)).toBe(anyPositive);
        },
      ),
    );
  });
});

describe("decideRowState — no pull request", () => {
  it("clean tree → none", () => {
    expect(decideRowState(facts({ gitPhase: "clean" }))).toEqual({ kind: "none" });
  });
  it("unknown git phase → none", () => {
    expect(decideRowState(facts({ gitPhase: "unknown" }))).toEqual({ kind: "none" });
  });
  it("uncommitted, agent idle → not busy", () => {
    expect(decideRowState(facts({ gitPhase: "uncommitted" }))).toEqual({
      kind: "uncommitted",
      busy: false,
    });
  });
  it("uncommitted, agent working → busy", () => {
    expect(decideRowState(facts({ gitPhase: "uncommitted", agentWorking: true }))).toEqual({
      kind: "uncommitted",
      busy: true,
    });
  });
  it("committed, agent working → busy", () => {
    expect(decideRowState(facts({ gitPhase: "committed", agentWorking: true }))).toEqual({
      kind: "committed",
      busy: true,
    });
  });
});

describe("decideRowState — with a pull request", () => {
  const pr = (over: Partial<PrSignal>): PrSignal => ({
    state: "open",
    checksState: "no_checks",
    mergeability: "mergeable",
    ...over,
  });

  it("open PR, no checks → pr-open", () => {
    expect(decideRowState(facts({ pr: pr({}) }))).toEqual({ kind: "pr-open" });
  });
  it("draft PR → pr-open by default", () => {
    expect(decideRowState(facts({ pr: pr({ state: "draft" }) }))).toEqual({
      kind: "pr-open",
    });
  });
  it("conflicting mergeability → pr-conflict", () => {
    expect(decideRowState(facts({ pr: pr({ mergeability: "conflicting" }) }))).toEqual({
      kind: "pr-conflict",
    });
  });
  it("passing checks → pr-reviewed", () => {
    expect(decideRowState(facts({ pr: pr({ checksState: "passing" }) }))).toEqual({
      kind: "pr-reviewed",
    });
  });
  it("pending checks → pr-checking", () => {
    expect(decideRowState(facts({ pr: pr({ checksState: "pending" }) }))).toEqual({
      kind: "pr-checking",
    });
  });
  it("merged & unseen → pr-merged", () => {
    expect(decideRowState(facts({ pr: pr({ state: "merged" }) }))).toEqual({
      kind: "pr-merged",
    });
  });
  it("merged & seen → falls through to git phase (clean → none)", () => {
    expect(
      decideRowState(facts({ pr: pr({ state: "merged" }), mergedSeen: true })),
    ).toEqual({ kind: "none" });
  });
  it("merged & seen with new commits → committed", () => {
    expect(
      decideRowState(
        facts({
          pr: pr({ state: "merged" }),
          mergedSeen: true,
          gitPhase: "committed",
        }),
      ),
    ).toEqual({ kind: "committed", busy: false });
  });
  it("closed-but-not-merged PR falls through to git phase", () => {
    expect(
      decideRowState(facts({ pr: pr({ state: "closed" }), gitPhase: "uncommitted" })),
    ).toEqual({ kind: "uncommitted", busy: false });
  });

  it("property: a live open/draft PR always outranks the git phase", () => {
    const phase = fc.constantFrom<GitPhaseName>("uncommitted", "committed", "clean", "unknown");
    fc.assert(
      fc.property(
        fc.constantFrom<"open" | "draft">("open", "draft"),
        fc.constantFrom(...CHECK_STATES),
        fc.constantFrom(...MERGEABILITIES),
        phase,
        fc.boolean(),
        (state, checksState, mergeability, gitPhase, agentWorking) => {
          const state0 = decideRowState(
            facts({ pr: { state, checksState, mergeability }, gitPhase, agentWorking }),
          );
          expect(state0.kind.startsWith("pr-")).toBe(true);
        },
      ),
    );
  });
});

type GitPhaseName = RowFacts["gitPhase"];

describe("livePrState (the PR branch the shell reuses to skip the git RPC)", () => {
  const pr = (over: Partial<PrSignal>): PrSignal => ({
    state: "open",
    checksState: "no_checks",
    mergeability: "mergeable",
    ...over,
  });

  it("merged & unseen → pr-merged", () => {
    expect(livePrState(pr({ state: "merged" }), false)).toEqual({
      kind: "pr-merged",
    });
  });
  it("merged & seen → null (defer to git phase)", () => {
    expect(livePrState(pr({ state: "merged" }), true)).toBeNull();
  });
  it("closed & not merged → null (defer to git phase)", () => {
    expect(livePrState(pr({ state: "closed" }), false)).toBeNull();
  });
  it("open with conflicting mergeability → pr-conflict", () => {
    expect(livePrState(pr({ mergeability: "conflicting" }), false)).toEqual({
      kind: "pr-conflict",
    });
  });
  it("open with passing checks → pr-reviewed", () => {
    expect(livePrState(pr({ checksState: "passing" }), false)).toEqual({
      kind: "pr-reviewed",
    });
  });
  it("open with pending checks → pr-checking", () => {
    expect(livePrState(pr({ checksState: "pending" }), false)).toEqual({
      kind: "pr-checking",
    });
  });
  it("open with failing checks → pr-open", () => {
    expect(livePrState(pr({ checksState: "failing" }), false)).toEqual({ kind: "pr-open" });
  });

  it("property: a live open/draft PR never returns null", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<"open" | "draft">("open", "draft"),
        fc.constantFrom(...CHECK_STATES),
        fc.constantFrom(...MERGEABILITIES),
        fc.boolean(),
        (state, checksState, mergeability, mergedSeen) => {
          expect(livePrState({ state, checksState, mergeability }, mergedSeen)).not.toBeNull();
        },
      ),
    );
  });
});

describe("rowStateToStatus", () => {
  it("none → null (clears the glyph)", () => {
    expect(rowStateToStatus({ kind: "none" })).toBeNull();
  });
  it("uncommitted idle → default tone", () => {
    expect(rowStateToStatus({ kind: "uncommitted", busy: false })?.tone).toBe("default");
  });
  it("uncommitted busy → running tone", () => {
    expect(rowStateToStatus({ kind: "uncommitted", busy: true })?.tone).toBe("running");
  });
  it("committed busy → running tone", () => {
    expect(rowStateToStatus({ kind: "committed", busy: true })?.tone).toBe("running");
  });
  it("pr-checking → running tone (blinks)", () => {
    expect(rowStateToStatus({ kind: "pr-checking" })?.tone).toBe("running");
  });
  it("pr-conflict → error tone", () => {
    expect(rowStateToStatus({ kind: "pr-conflict" })?.tone).toBe("error");
  });
  it("pr-reviewed → success tone", () => {
    expect(rowStateToStatus({ kind: "pr-reviewed" })?.tone).toBe("success");
  });
  it("pr-merged → success tone", () => {
    expect(rowStateToStatus({ kind: "pr-merged" })?.tone).toBe("success");
  });

  const nonNull: RowState[] = [
    { kind: "uncommitted", busy: false },
    { kind: "committed", busy: false },
    { kind: "pr-open" },
    { kind: "pr-checking" },
    { kind: "pr-conflict" },
    { kind: "pr-reviewed" },
    { kind: "pr-merged" },
  ];
  for (const state of nonNull) {
    it(`${state.kind} → a non-empty icon and label`, () => {
      const status = rowStateToStatus(state);
      expect(status).not.toBeNull();
      expect(status?.icon.length ?? 0).toBeGreaterThan(0);
      expect(status?.label.length ?? 0).toBeGreaterThan(0);
    });
  }
});

describe("withOpRunning", () => {
  const status = (tone: RowStatus["tone"]): RowStatus => ({ icon: "GitMerge", label: "x", tone });

  it("no operation → the status is returned unchanged", () => {
    const s = status("success");
    expect(withOpRunning(s, false)).toBe(s);
  });

  it("a cleared glyph stays cleared — nothing to pulse", () => {
    expect(withOpRunning(null, true)).toBeNull();
  });

  it("an operation forces the running tone over any other tone", () => {
    expect(withOpRunning(status("default"), true)?.tone).toBe("running");
    expect(withOpRunning(status("error"), true)?.tone).toBe("running");
    expect(withOpRunning(status("success"), true)?.tone).toBe("running");
  });

  it("keeps the icon and label; only the tone changes", () => {
    const s = status("error");
    expect(withOpRunning(s, true)).toEqual({ icon: "GitMerge", label: "x", tone: "running" });
  });

  it("an already-running glyph is returned by identity, so no redundant re-push", () => {
    const s = status("running");
    expect(withOpRunning(s, true)).toBe(s);
  });

  it("property: with an operation, a non-null glyph always ends up running", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<RowStatus["tone"]>("default", "error", "running", "success"),
        (tone) => {
          expect(withOpRunning(status(tone), true)?.tone).toBe("running");
        },
      ),
    );
  });
});

describe("decideRowStatus (end to end)", () => {
  it("clean, idle, no PR → null", () => {
    expect(decideRowStatus(facts())).toBeNull();
  });
  it("merged & unseen → merged glyph, success tone", () => {
    expect(
      decideRowStatus(
        facts({ pr: { state: "merged", checksState: "no_checks", mergeability: "mergeable" } }),
      ),
    ).toEqual({ icon: expect.any(String), label: "Pull request merged", tone: "success" });
  });
});
