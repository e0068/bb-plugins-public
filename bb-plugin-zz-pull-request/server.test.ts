import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

// The `bb` CLI the task-status transitions shell out to is pinned to a
// stand-in for the whole suite: whether a real `bb` happens to be on this
// machine must not decide what these tests see. /bin/echo always exists,
// always exits 0, and never prints JSON — which reads as "the CLI ran and
// no task is linked", the neutral case every test here was written against.
process.env.BB_CLI = "/bin/echo";

// A thin integration test of the prState wiring: runs the real rpc contract
// over a stubbed bb.sdk and checks that the environment's git status and PR
// state correctly resolve into the button's visibility decision.

interface StatusStub {
  hasUncommittedChanges: boolean;
  aheadCount: number;
  behindCount?: number;
  /** The current branch's HEAD — fixed by default, so a merge can recognize "the same commit". */
  headSha?: string;
  /** The resolved merge-base — the parent of the PR commit. `null` by default: bb didn't resolve it. */
  baseRef?: string | null;
}

type PrState = "open" | "draft" | "merged" | "closed";
type ChecksState = "failing" | "no_checks" | "passing" | "pending" | "unknown";
type RawMergeable = "CONFLICTING" | "MERGEABLE" | "UNKNOWN";

interface HostOptions {
  environmentId: string | null;
  status?: StatusStub;
  pr?: {
    outcome: "absent" | "available" | "unavailable";
    url?: string;
    number?: number;
    state?: PrState;
    checksState?: ChecksState;
    /** Defaults to "MERGEABLE" — matches how every pre-existing test's PR behaved before this field existed. */
    mergeable?: RawMergeable;
  };
  prThrows?: boolean;
  mergePullRequest?: () => Promise<unknown>;
  unarchive?: () => Promise<unknown>;
  archive?: () => Promise<unknown>;
  /** The environment's lifecycle status. Defaults to "ready". */
  environmentStatus?: "destroyed" | "destroying" | "error" | "provisioning" | "ready" | "retiring";
  /**
   * The environment's working copy. `null` by default on purpose: the content
   * check (src/wiring/merged-content.ts) shells out to real git when there is
   * a path, and these tests are about the wiring, not about git. Tests that
   * need the real-git path — the local main pull — pass one explicitly.
   */
  path?: string | null;
  /** The environment's current branch. `null` by default — gatherAndCreate refuses without one. */
  branchName?: string | null;
  /** When the thread was archived, in epoch ms. `null` by default — a live thread. */
  archivedAt?: number | null;
}

// `options` is read lazily on every call (not snapshotted once when the host
// is created) — so a test can merge a PR, then swap options.pr/options.status
// to look "as if GitHub responded merged", and reuse the same bb/harness
// (and with it the same kv) for a second RPC call.
function statusResultOf(status: StatusStub | undefined) {
  if (status === undefined) return { outcome: "unavailable" as const, message: "no git" };
  return {
    outcome: "available" as const,
    workspace: {
      workingTree: { hasUncommittedChanges: status.hasUncommittedChanges },
      mergeBase: {
        aheadCount: status.aheadCount,
        behindCount: status.behindCount ?? 0,
        baseRef: status.baseRef ?? null,
        files: [],
        commits: [],
      },
      checkout: { kind: "branch" as const, branchName: "task", headSha: status.headSha ?? "sha-current" },
    },
  };
}

function prResultOf(pr: HostOptions["pr"]) {
  return pr?.outcome === "available"
    ? {
        outcome: "available",
        pullRequest: {
          url: pr.url ?? "https://x",
          number: pr.number ?? 9,
          state: pr.state ?? "open",
          checks: { state: pr.checksState ?? "no_checks" },
          mergeability: { mergeable: pr.mergeable ?? "MERGEABLE" },
        },
      }
    : { outcome: pr?.outcome ?? "absent" };
}

// bb answers about git only for a `ready` environment: both routes go through
// `requireReadyEnvironment`, which THROWS for any other status. The fake has
// to refuse the same way, or a test can never tell "bb said no PR" apart from
// "bb refused to say" — the very confusion the retiring fallback fixes.
function refuseUnlessReady(options: HostOptions): void {
  const status = options.environmentStatus ?? "ready";
  if (status !== "ready") throw new Error(`environment_not_ready: ${status}`);
}

function host(options: HostOptions) {
  return createFakePluginHost({
    pluginId: "pull-request",
    sdk: {
      subscribe: () => () => {},
      threads: {
        get: async () => ({
          environmentId: options.environmentId,
          archivedAt: options.archivedAt ?? null,
        }),
        unarchive: options.unarchive ?? (async () => ({ ok: true })),
        archive: options.archive ?? (async () => ({ ok: true })),
      },
      environments: {
        get: async () => ({
          mergeBaseBranch: null,
          defaultBranch: "main",
          baseBranch: "origin/main",
          path: options.path ?? null,
          branchName: options.branchName ?? null,
          status: options.environmentStatus ?? "ready",
        }),
        status: async () => {
          refuseUnlessReady(options);
          return statusResultOf(options.status);
        },
        pullRequest: async () => {
          refuseUnlessReady(options);
          if (options.prThrows) throw new Error("409 personal environment");
          return prResultOf(options.pr);
        },
        mergePullRequest:
          options.mergePullRequest ?? (async () => ({ ok: true, action: "pull_request_merge" })),
      },
    },
  });
}

async function prState(options: Parameters<typeof host>[0]) {
  const { bb, harness } = host(options);
  await plugin(bb);
  return harness.behavior.callRpc("prState", { threadId: "t1" });
}

async function fastForwardState(options: Parameters<typeof host>[0]) {
  const { bb, harness } = host(options);
  await plugin(bb);
  return harness.behavior.callRpc("fastForwardState", { threadId: "t1" });
}

async function mergeState(options: Parameters<typeof host>[0]) {
  const { bb, harness } = host(options);
  await plugin(bb);
  return harness.behavior.callRpc("mergeState", { threadId: "t1" });
}

async function archiveState(options: Parameters<typeof host>[0]) {
  const { bb, harness } = host(options);
  await plugin(bb);
  return harness.behavior.callRpc("archiveState", { threadId: "t1" });
}

async function gitPhase(options: Parameters<typeof host>[0]) {
  const { bb, harness } = host(options);
  await plugin(bb);
  return harness.behavior.callRpc("rowFacts", { threadId: "t1" });
}

describe("prState (wiring)", () => {
  // No `path` here (defaults to null, no working copy) — so the content
  // check never runs and the reason is the flagged "content-unknown", not a
  // confirmed "ready". Visible either way: the point of this test is that
  // clean + ahead + no PR doesn't hide on its own.
  it("clean + ahead of base + PR absent → visible", async () => {
    expect(
      await prState({
        environmentId: "env1",
        status: { hasUncommittedChanges: false, aheadCount: 2 },
        pr: { outcome: "absent" },
      }),
    ).toEqual({ visible: true, reason: "content-unknown", prUrl: null, nextNumber: null });
  });

  // The one place where the wiring meets real git: with a working copy on
  // disk both the live aheadCount (liveAheadOf) and the content check
  // actually shell out. The path here doesn't exist, so git refuses both —
  // aheadCount falls back to the cached value (2, same as above), and a
  // refusal on the content check must not withhold the button either, since
  // "couldn't measure" is not "already merged"; it's flagged instead of
  // called "ready" so the front end can show that git didn't confirm it. The
  // same missing path also makes the nextNumber preview (readOrigin) fail
  // closed to null, without ever touching a token or the network.
  it("git can't answer (a working copy that isn't there) → still visible, flagged", async () => {
    expect(
      await prState({
        environmentId: "env1",
        path: "/tmp/does-not-exist-worktree",
        status: { hasUncommittedChanges: false, aheadCount: 2 },
        pr: { outcome: "absent" },
      }),
    ).toEqual({ visible: true, reason: "content-unknown", prUrl: null, nextNumber: null });
  });

  // With a working copy on disk, "nothing-to-pr" now also goes through the
  // live aheadCount (liveAheadOf) before falling back to the cache — same
  // path as above, just the branch where the cached count is 0.
  it("nothing ahead of base, with a (nonexistent) working copy on disk → hidden", async () => {
    expect(
      await prState({
        environmentId: "env1",
        path: "/tmp/does-not-exist-worktree",
        status: { hasUncommittedChanges: false, aheadCount: 0 },
        pr: { outcome: "absent" },
      }),
    ).toEqual({ visible: false, reason: "nothing-to-pr", prUrl: null, nextNumber: null });
  });

  it("uncommitted changes → hidden", async () => {
    expect(
      await prState({
        environmentId: "env1",
        status: { hasUncommittedChanges: true, aheadCount: 2 },
        pr: { outcome: "absent" },
      }),
    ).toEqual({ visible: false, reason: "dirty", prUrl: null, nextNumber: null });
  });

  it("a live PR (open) → hidden, but the url is still returned", async () => {
    expect(
      await prState({
        environmentId: "env1",
        status: { hasUncommittedChanges: false, aheadCount: 2 },
        pr: {
          outcome: "available",
          state: "open",
          url: "https://github.com/e0068/bb-plugins/pull/9",
        },
      }),
    ).toEqual({
      visible: false,
      reason: "pr-exists",
      prUrl: "https://github.com/e0068/bb-plugins/pull/9",
      nextNumber: null,
    });
  });

  // Same no-path caveat as above: content-unknown, not a confirmed ready.
  it("PR merged + new commit ahead → visible again", async () => {
    expect(
      await prState({
        environmentId: "env1",
        status: { hasUncommittedChanges: false, aheadCount: 1 },
        pr: {
          outcome: "available",
          state: "merged",
          url: "https://github.com/e0068/bb-plugins/pull/9",
        },
      }),
    ).toEqual({
      visible: true,
      reason: "content-unknown",
      prUrl: "https://github.com/e0068/bb-plugins/pull/9",
      nextNumber: null,
    });
  });

  // A `settled` host verdict is the one case resolvePrSignal pays to
  // double-check directly against GitHub (see its own comment on why —
  // memory/decisions/open-pr-bypass-host-terminal-signal.md). With a
  // branch/path set the attempt actually runs, but this fake host has no
  // `sdk.files` to read origin from — readOrigin throws, the refinement
  // catches it and falls back to the host's own (unrefined) signal, exactly
  // as if there had been no path at all.
  it("settled PR, live-check attempt fails (no origin to read) → falls back to the host's own settled verdict", async () => {
    expect(
      await prState({
        environmentId: "env1",
        path: "/tmp/does-not-exist-worktree",
        branchName: "bb/thr_abc",
        status: { hasUncommittedChanges: false, aheadCount: 1 },
        pr: {
          outcome: "available",
          state: "merged",
          url: "https://github.com/e0068/bb-plugins/pull/9",
        },
      }),
    ).toEqual({
      visible: true,
      reason: "content-unknown",
      prUrl: "https://github.com/e0068/bb-plugins/pull/9",
      nextNumber: null,
    });
  });

  it("the thread has no environment → hidden", async () => {
    expect(await prState({ environmentId: null })).toEqual({
      visible: false,
      reason: "no-environment",
      prUrl: null,
      nextNumber: null,
    });
  });

  it("pullRequest throws (personal/non-git environment) → hidden, doesn't fail", async () => {
    expect(
      await prState({
        environmentId: "env1",
        status: { hasUncommittedChanges: false, aheadCount: 2 },
        prThrows: true,
      }),
    ).toEqual({ visible: false, reason: "pr-unknown", prUrl: null, nextNumber: null });
  });

  it("git unavailable in the environment → hidden", async () => {
    expect(await prState({ environmentId: "env1" })).toEqual({
      visible: false,
      reason: "status-unavailable",
      prUrl: null,
      nextNumber: null,
    });
  });
});

describe("fastForwardState (wiring)", () => {
  it("behind, no commits of our own, clean → visible", async () => {
    expect(
      await fastForwardState({
        environmentId: "env1",
        status: { hasUncommittedChanges: false, aheadCount: 0, behindCount: 3 },
      }),
    ).toEqual({ visible: true, reason: "ready" });
  });

  it("not behind → hidden", async () => {
    expect(
      await fastForwardState({
        environmentId: "env1",
        status: { hasUncommittedChanges: false, aheadCount: 0, behindCount: 0 },
      }),
    ).toEqual({ visible: false, reason: "up-to-date" });
  });

  it("commits of our own ahead while behind → hidden (diverged)", async () => {
    expect(
      await fastForwardState({
        environmentId: "env1",
        status: { hasUncommittedChanges: false, aheadCount: 2, behindCount: 3 },
      }),
    ).toEqual({ visible: false, reason: "diverged" });
  });

  it("the thread has no environment → hidden", async () => {
    expect(await fastForwardState({ environmentId: null })).toEqual({
      visible: false,
      reason: "no-environment",
    });
  });

  it("git unavailable in the environment → hidden", async () => {
    expect(await fastForwardState({ environmentId: "env1" })).toEqual({
      visible: false,
      reason: "status-unavailable",
    });
  });

  // The one place where the wiring meets real git: with a working copy on
  // disk, the live ahead-count actually shells out (see liveAheadCount's doc
  // comment in src/wiring/fast-forward.ts — bb's cached aheadCount can sit
  // stale at 0 well after the branch has diverged). The path here doesn't
  // exist, so git refuses to measure — and a refusal must fall back to the
  // cache, not hide the button on a shrug.
  it("git can't answer (a working copy that isn't there) → falls back to the cached count", async () => {
    expect(
      await fastForwardState({
        environmentId: "env1",
        path: "/tmp/does-not-exist-worktree",
        status: { hasUncommittedChanges: false, aheadCount: 0, behindCount: 3 },
      }),
    ).toEqual({ visible: true, reason: "ready" });
  });
});

describe("fastForward (wiring)", () => {
  // env.path in the fake host is a nonexistent directory, so the real git
  // fetch inside runFastForward inevitably refuses; the actual fetch → live
  // ahead-check → merge --ff-only sequence is verified without real git in
  // src/wiring/fast-forward.test.ts. Here we only check that a failed
  // fastForward still republishes — see the try/finally in server.ts: a
  // refusal used to leave fastForwardState's cache-backed "ready" answer on
  // screen until the next 20-second poll, so every click in between failed
  // the same way with no way for the front end to learn it should re-check.
  it("a failed fast-forward still publishes \"changed\" so the front end re-checks promptly", async () => {
    const { bb, harness } = host({
      environmentId: "env1",
      path: "/tmp/does-not-exist-worktree",
      status: { hasUncommittedChanges: false, aheadCount: 0, behindCount: 3 },
    });
    await plugin(bb);
    await expect(harness.behavior.callRpc("fastForward", { threadId: "t1" })).rejects.toThrow();
    const changed = harness.realtimeSignals.filter((signal) => signal.channel === "changed");
    expect(changed.length).toBeGreaterThanOrEqual(1);
  });
});

describe("mergeState (wiring)", () => {
  it("PR open + checks passing → visible, indicator success", async () => {
    expect(
      await mergeState({
        environmentId: "env1",
        pr: {
          outcome: "available",
          state: "open",
          checksState: "passing",
          url: "https://github.com/e0068/bb-plugins/pull/9",
        },
      }),
    ).toEqual({
      visible: true,
      indicator: "success",
      prUrl: "https://github.com/e0068/bb-plugins/pull/9",
      number: 9,
    });
  });

  it("PR open + checks failing → visible, indicator failure", async () => {
    expect(
      await mergeState({
        environmentId: "env1",
        pr: { outcome: "available", state: "open", checksState: "failing" },
      }),
    ).toEqual({ visible: true, indicator: "failure", prUrl: "https://x", number: 9 });
  });

  it("PR open + conflicting → visible, indicator conflict (overrides passing checks)", async () => {
    expect(
      await mergeState({
        environmentId: "env1",
        pr: { outcome: "available", state: "open", checksState: "passing", mergeable: "CONFLICTING" },
      }),
    ).toEqual({ visible: true, indicator: "conflict", prUrl: "https://x", number: 9 });
  });

  it("PR merged → hidden, indicator unknown", async () => {
    expect(
      await mergeState({
        environmentId: "env1",
        pr: { outcome: "available", state: "merged", checksState: "passing" },
      }),
    ).toEqual({ visible: false, indicator: "unknown", prUrl: "https://x", number: 9 });
  });

  it("no PR → hidden, prUrl null", async () => {
    expect(await mergeState({ environmentId: "env1", pr: { outcome: "absent" } })).toEqual({
      visible: false,
      indicator: "unknown",
      prUrl: null,
      number: null,
    });
  });

  // Same live-check attempt as prState's — see that describe block's own
  // comment. With a branch/path set the attempt runs and fails (no
  // `sdk.files` in this fake host), falling back to the host's own settled
  // verdict, same result as the no-path "PR merged" case above.
  it("settled PR, live-check attempt fails → falls back to the host's own settled verdict", async () => {
    expect(
      await mergeState({
        environmentId: "env1",
        path: "/tmp/does-not-exist-worktree",
        branchName: "bb/thr_abc",
        pr: { outcome: "available", state: "merged", checksState: "passing" },
      }),
    ).toEqual({ visible: false, indicator: "unknown", prUrl: "https://x", number: 9 });
  });

  it("the thread has no environment → hidden", async () => {
    expect(await mergeState({ environmentId: null })).toEqual({
      visible: false,
      indicator: "unknown",
      prUrl: null,
      number: null,
    });
  });

  it("pullRequest throws → hidden, doesn't fail", async () => {
    expect(await mergeState({ environmentId: "env1", prThrows: true })).toEqual({
      visible: false,
      indicator: "unknown",
      prUrl: null,
      number: null,
    });
  });
});

describe("wakeUpState (wiring)", () => {
  it("environment retiring → visible", async () => {
    const { bb, harness } = host({ environmentId: "env1", environmentStatus: "retiring" });
    await plugin(bb);
    expect(await harness.behavior.callRpc("wakeUpState", { threadId: "t1" })).toEqual({
      visible: true,
    });
  });

  it("environment ready → hidden", async () => {
    const { bb, harness } = host({ environmentId: "env1", environmentStatus: "ready" });
    await plugin(bb);
    expect(await harness.behavior.callRpc("wakeUpState", { threadId: "t1" })).toEqual({
      visible: false,
    });
  });

  it("the thread has no environment → hidden", async () => {
    const { bb, harness } = host({ environmentId: null });
    await plugin(bb);
    expect(await harness.behavior.callRpc("wakeUpState", { threadId: "t1" })).toEqual({
      visible: false,
    });
  });
});

describe("wakeUp", () => {
  it("unarchives the thread — bb's own unarchive route cancels a stuck retire as a side effect", async () => {
    const calls: unknown[] = [];
    const { bb, harness } = host({
      environmentId: "env1",
      environmentStatus: "retiring",
      unarchive: async () => {
        calls.push("called");
        return { ok: true };
      },
    });
    await plugin(bb);
    expect(await harness.behavior.callRpc("wakeUp", { threadId: "t1" })).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
  });

  it("publishes \"changed\" right on success — the front end doesn't wait for polling", async () => {
    const { bb, harness } = host({ environmentId: "env1", environmentStatus: "retiring" });
    await plugin(bb);
    await harness.behavior.callRpc("wakeUp", { threadId: "t1" });
    const changed = harness.realtimeSignals.filter((signal) => signal.channel === "changed");
    expect(changed).toHaveLength(1);
  });
});

describe("archiveState (wiring)", () => {
  it("PR merged + clean tree → visible", async () => {
    expect(
      await archiveState({
        environmentId: "env1",
        status: { hasUncommittedChanges: false, aheadCount: 0 },
        pr: { outcome: "available", state: "merged" },
      }),
    ).toEqual({ visible: true, reason: "ready" });
  });

  it("PR merged + uncommitted changes → hidden (dirty)", async () => {
    expect(
      await archiveState({
        environmentId: "env1",
        status: { hasUncommittedChanges: true, aheadCount: 0 },
        pr: { outcome: "available", state: "merged" },
      }),
    ).toEqual({ visible: false, reason: "dirty" });
  });

  it("PR merged but new commits ahead → hidden (unlanded-commits), never next to Pull Request", async () => {
    // The "Pull Request" button lives on exactly these facts (settled PR, clean
    // tree, commits ahead), so Archive must step aside instead of showing beside it.
    expect(
      await archiveState({
        environmentId: "env1",
        status: { hasUncommittedChanges: false, aheadCount: 1 },
        pr: { outcome: "available", state: "merged" },
      }),
    ).toEqual({ visible: false, reason: "unlanded-commits" });
  });

  it("PR still open → hidden (not-merged), status is never even fetched", async () => {
    expect(
      await archiveState({
        environmentId: "env1",
        pr: { outcome: "available", state: "open" },
      }),
    ).toEqual({ visible: false, reason: "not-merged" });
  });

  it("no PR at all → hidden (not-merged)", async () => {
    expect(
      await archiveState({ environmentId: "env1", pr: { outcome: "absent" } }),
    ).toEqual({ visible: false, reason: "not-merged" });
  });

  // Same live-check attempt as prState's/mergeState's — see prState's own
  // comment. With a branch/path set the attempt runs and fails (no
  // `sdk.files` in this fake host), falling back to the host's own settled
  // verdict — same "visible" outcome as the no-path "PR merged" case above.
  it("PR merged, live-check attempt fails → falls back to the host's own settled verdict", async () => {
    expect(
      await archiveState({
        environmentId: "env1",
        path: "/tmp/does-not-exist-worktree",
        branchName: "bb/thr_abc",
        status: { hasUncommittedChanges: false, aheadCount: 0 },
        pr: { outcome: "available", state: "merged" },
      }),
    ).toEqual({ visible: true, reason: "ready" });
  });

  it("the thread has no environment → hidden", async () => {
    expect(await archiveState({ environmentId: null })).toEqual({
      visible: false,
      reason: "no-environment",
    });
  });

  it("git unavailable in the environment after a merge → hidden", async () => {
    expect(
      await archiveState({
        environmentId: "env1",
        pr: { outcome: "available", state: "merged" },
      }),
    ).toEqual({ visible: false, reason: "status-unavailable" });
  });

  // Same staleness guard as prState/fastForwardState (liveAheadCount's doc
  // comment in src/wiring/fast-forward.ts): "un-landed commits" must not
  // trust bb's cached aheadCount alone. With a working copy on disk this now
  // shells out to measure it live; the path here doesn't exist, so git
  // refuses and the cached count (0) is used instead — same "visible" result
  // as before the live check existed.
  it("PR merged + clean tree, with a (nonexistent) working copy on disk → still visible", async () => {
    expect(
      await archiveState({
        environmentId: "env1",
        path: "/tmp/does-not-exist-worktree",
        status: { hasUncommittedChanges: false, aheadCount: 0 },
        pr: { outcome: "available", state: "merged" },
      }),
    ).toEqual({ visible: true, reason: "ready" });
  });

  // The bug this fallback exists for: bb refuses to answer about a retiring
  // environment, and the refusal used to be reported as "not-merged" — a
  // verdict nobody measured. It must now name its own ignorance instead, so
  // the local-git fallback (src/wiring/local-archive-facts.ts) is what decides.
  //
  // The path must NOT exist, and must not be "improved" into a real temp
  // directory. A cwd that does not exist fails before git even runs — the
  // spawn itself returns ENOENT, which git-client.ts reports as a plain
  // non-zero code — and it does so no matter what surrounds it. A real empty
  // directory instead makes git walk UP and answer for whatever repository
  // encloses it; measured, and it happily reported this very checkout's
  // status. Determinism here comes from absence.
  it("retiring environment, no working copy to measure → hidden as \"landing-unknown\", never \"not-merged\"", async () => {
    expect(
      await archiveState({
        environmentId: "env1",
        environmentStatus: "retiring",
        path: "/tmp/does-not-exist-worktree",
        status: { hasUncommittedChanges: false, aheadCount: 0 },
        pr: { outcome: "available", state: "merged" },
      }),
    ).toEqual({ visible: false, reason: "landing-unknown" });
  });

  it("retiring environment with no path at all → hidden as \"landing-unknown\"", async () => {
    expect(
      await archiveState({ environmentId: "env1", environmentStatus: "retiring" }),
    ).toEqual({ visible: false, reason: "landing-unknown" });
  });

  // A destroying/destroyed environment is refused by bb for the same reason;
  // the fallback is keyed on "bb won't answer", not on the word "retiring".
  it("destroying environment → same fallback, not an unhandled throw", async () => {
    expect(
      await archiveState({ environmentId: "env1", environmentStatus: "destroying" }),
    ).toEqual({ visible: false, reason: "landing-unknown" });
  });
});

describe("archiveThread", () => {
  // Marking linked tasks done goes through the real `bb tasks current` (see
  // src/wiring/mark-task-status.ts) — the same trust boundary this suite
  // already crosses for `gh auth token` in the createPr tests below. Thread
  // id "t1" isn't a real bb thread id (bb's own `--thread` validation
  // rejects it, e.g. "must start with \"thr_\""), so the listing step itself
  // fails and `doneTasks`/`failedTasks` come back empty — same outcome a
  // genuinely linkless thread would produce, which is the point: this suite
  // can't tell the two apart, only mark-task-status.test.ts (fake ports)
  // can. The list → mark-status sequencing, and a failed status-transition
  // surfacing its reason instead of vanishing, are both covered there
  // without any real process.

  // The same "PR merged + clean tree" facts archiveState's own tests use —
  // the one state where the guard below lets the action through at all.
  const readyOptions = {
    environmentId: "env1",
    status: { hasUncommittedChanges: false, aheadCount: 0 },
    pr: { outcome: "available", state: "merged" },
  } as const;

  it("archives the thread when the PR is merged and the tree is clean", async () => {
    const calls: unknown[] = [];
    const { bb, harness } = host({
      ...readyOptions,
      archive: async () => {
        calls.push("called");
        return { ok: true };
      },
    });
    await plugin(bb);
    expect(await harness.behavior.callRpc("archiveThread", { threadId: "t1" })).toEqual({
      ok: true,
      doneTasks: [],
      failedTasks: [],
      taskCliError: null,
    });
    expect(calls).toHaveLength(1);
  });

  it("publishes \"changed\" right on success — the front end doesn't wait for polling", async () => {
    const { bb, harness } = host(readyOptions);
    await plugin(bb);
    await harness.behavior.callRpc("archiveThread", { threadId: "t1" });
    const changed = harness.realtimeSignals.filter((signal) => signal.channel === "changed");
    expect(changed).toHaveLength(1);
  });

  // The button itself only renders once archiveState says visible, but the
  // RPC is a separate call the front end could reach with a stale render —
  // or anyone could hit directly — after the PR/tree state moved on. It must
  // re-check on its own, the same way archiveState computes visibility, and
  // refuse before marking any task done or touching the thread at all.
  it("refuses to archive an unmerged PR — no task marked, thread not archived", async () => {
    const calls: unknown[] = [];
    const { bb, harness } = host({
      environmentId: "env1",
      pr: { outcome: "available", state: "open" },
      archive: async () => {
        calls.push("called");
        return { ok: true };
      },
    });
    await plugin(bb);
    await expect(harness.behavior.callRpc("archiveThread", { threadId: "t1" })).rejects.toThrow(
      "Cannot archive: not-merged",
    );
    expect(calls).toHaveLength(0);
  });

  it("refuses to archive a dirty tree, even with a merged PR", async () => {
    const calls: unknown[] = [];
    const { bb, harness } = host({
      environmentId: "env1",
      status: { hasUncommittedChanges: true, aheadCount: 0 },
      pr: { outcome: "available", state: "merged" },
      archive: async () => {
        calls.push("called");
        return { ok: true };
      },
    });
    await plugin(bb);
    await expect(harness.behavior.callRpc("archiveThread", { threadId: "t1" })).rejects.toThrow(
      "Cannot archive: dirty",
    );
    expect(calls).toHaveLength(0);
  });

  it("refuses to archive commits landed after the merge (unlanded-commits)", async () => {
    const calls: unknown[] = [];
    const { bb, harness } = host({
      environmentId: "env1",
      status: { hasUncommittedChanges: false, aheadCount: 1 },
      pr: { outcome: "available", state: "merged" },
      archive: async () => {
        calls.push("called");
        return { ok: true };
      },
    });
    await plugin(bb);
    await expect(harness.behavior.callRpc("archiveThread", { threadId: "t1" })).rejects.toThrow(
      "Cannot archive: unlanded-commits",
    );
    expect(calls).toHaveLength(0);
  });
});

// bb shows its own "Thread is archived / Unarchive" bar on an archived
// thread, and archiving twice does nothing — so the plugin's button has no
// job left there. Hidden on the thread's own archivedAt, before any git or
// GitHub fact is even looked up.
describe("archiveState — an archived thread", () => {
  const landedOptions = {
    environmentId: "env1",
    status: { hasUncommittedChanges: false, aheadCount: 0 },
    pr: { outcome: "available", state: "merged" },
  } as const;

  it("hides the button on a thread that is already archived", async () => {
    expect(await archiveState({ ...landedOptions, archivedAt: 1_700_000_000_000 })).toEqual({
      visible: false,
      reason: "already-archived",
    });
  });

  it("the same thread while live still shows it — the archive is what changed", async () => {
    expect(await archiveState(landedOptions)).toEqual({ visible: true, reason: "ready" });
  });

  // The button is one caller among several: a stale render, or the RPC hit
  // directly, must not re-archive and re-mark tasks done on a thread that is
  // already put away.
  it("archiveThread refuses on an archived thread — no task marked, nothing archived", async () => {
    const calls: unknown[] = [];
    const { bb, harness } = host({
      ...landedOptions,
      archivedAt: 1_700_000_000_000,
      archive: async () => {
        calls.push("called");
        return { ok: true };
      },
    });
    await plugin(bb);
    await expect(harness.behavior.callRpc("archiveThread", { threadId: "t1" })).rejects.toThrow(
      "Cannot archive: already-archived",
    );
    expect(calls).toHaveLength(0);
  });
});

// The sidebar row-status content script only calls this RPC once the host's
// own per-row PR signal (experimental_useSidebarThreadPullRequest, read
// client-side) has nothing live to show — see row-status-content.tsx. So
// these tests only cover the plain git-phase computation and the
// `liveOpenPr` field's cheap-path/fallback behavior; a genuinely *found*
// live PR is already fully specified at the pure-core level
// (open-pr-refinement.test.ts) and the network-wiring level
// (open-pr-lookup.test.ts) — reproducing a real fetch+origin round trip here
// would just duplicate those, the same restraint prState's own tests take.
describe("rowFacts (wiring)", () => {
  it("uncommitted changes, no PR → uncommitted, pr null", async () => {
    expect(
      await gitPhase({
        environmentId: "env1",
        status: { hasUncommittedChanges: true, aheadCount: 0 },
        pr: { outcome: "absent" },
      }),
    ).toEqual({ gitPhase: "uncommitted", pr: null });
  });

  it("committed, ahead of base, no PR → committed, pr null", async () => {
    expect(
      await gitPhase({
        environmentId: "env1",
        status: { hasUncommittedChanges: false, aheadCount: 2 },
        pr: { outcome: "absent" },
      }),
    ).toEqual({ gitPhase: "committed", pr: null });
  });

  it("clean tree, no PR → clean, pr null", async () => {
    expect(
      await gitPhase({
        environmentId: "env1",
        status: { hasUncommittedChanges: false, aheadCount: 0 },
        pr: { outcome: "absent" },
      }),
    ).toEqual({ gitPhase: "clean", pr: null });
  });

  // The glyph's whole reason for going quiet: the plugin merges by squash
  // through the API, so a branch whose content is in main still reads
  // `aheadCount > 0` forever. Without the content check the sidebar kept
  // saying "committed changes" about a thread with nothing left to merge.
  it("after the merge, a branch that still reads ahead → clean, no glyph", async () => {
    const options: Parameters<typeof host>[0] = {
      environmentId: "env1",
      status: { hasUncommittedChanges: false, aheadCount: 8, headSha: "sha-1" },
      pr: { outcome: "available", state: "open", checksState: "passing" },
    };
    const { bb, harness } = host(options);
    await plugin(bb);

    await harness.behavior.callRpc("mergePr", { threadId: "t1" });
    options.pr = { outcome: "available", state: "merged" };

    const facts = await harness.behavior.callRpc("rowFacts", { threadId: "t1" });
    expect(facts.gitPhase).toBe("clean");
  });

  it("a new commit after the merge (different HEAD) → committed again", async () => {
    const options: Parameters<typeof host>[0] = {
      environmentId: "env1",
      status: { hasUncommittedChanges: false, aheadCount: 8, headSha: "sha-1" },
      pr: { outcome: "available", state: "open", checksState: "passing" },
    };
    const { bb, harness } = host(options);
    await plugin(bb);

    await harness.behavior.callRpc("mergePr", { threadId: "t1" });
    options.pr = { outcome: "available", state: "merged" };
    options.status = { hasUncommittedChanges: false, aheadCount: 1, headSha: "sha-2" };

    const facts = await harness.behavior.callRpc("rowFacts", { threadId: "t1" });
    expect(facts.gitPhase).toBe("committed");
  });

  it("git status unavailable → gitPhase unknown, pr null", async () => {
    expect(await gitPhase({ environmentId: "env1", pr: { outcome: "absent" } })).toEqual({
      gitPhase: "unknown",
      pr: null,
    });
  });

  it("the thread has no environment → unknown, pr null", async () => {
    expect(await gitPhase({ environmentId: null })).toEqual({ gitPhase: "unknown", pr: null });
  });

  // Same live-check attempt as prState's — see that describe block's own
  // comment (resolvePrSignal only pays for a GitHub round trip when the host
  // says `settled`, see its own comment in server.ts). A `settled` host PR
  // with a branch/path set runs the attempt, which fails (no `sdk.files` in
  // this fake host) and falls back to the host's own (unrefined) facts —
  // still surfaced as `pr`, just not upgraded to `open`.
  it("settled PR, live-check attempt fails → falls back to the host's own settled facts", async () => {
    expect(
      await gitPhase({
        environmentId: "env1",
        path: "/tmp/does-not-exist-worktree",
        branchName: "bb/thr_abc",
        status: { hasUncommittedChanges: false, aheadCount: 3 },
        pr: { outcome: "available", state: "merged" },
      }),
    ).toEqual({
      gitPhase: "committed",
      pr: { number: 9, state: "merged", checksState: "no_checks", mergeability: "mergeable" },
    });
  });

  it("a live (open) PR host-side → surfaced as pr, no network attempted (presence already open)", async () => {
    expect(
      await gitPhase({
        environmentId: "env1",
        status: { hasUncommittedChanges: false, aheadCount: 1 },
        pr: { outcome: "available", state: "open" },
      }),
    ).toEqual({
      gitPhase: "committed",
      pr: { number: 9, state: "open", checksState: "no_checks", mergeability: "mergeable" },
    });
  });
});

// The KV cache of the merged fact, seen through the RPCs: mergePr primes it,
// prState reads it. Whether the fact itself is measured correctly when the
// cache is cold — including a merge done outside the plugin — is covered in
// src/wiring/visibility-decision.test.ts, without shelling out to git.
describe("merged-head cache after a squash merge (mergePr → prState wiring)", () => {
  it("the same HEAD after mergePr doesn't let the PR show again, even though aheadCount > 0", async () => {
    const options: Parameters<typeof host>[0] = {
      environmentId: "env1",
      status: { hasUncommittedChanges: false, aheadCount: 8, headSha: "sha-1" },
      pr: { outcome: "available", state: "open", checksState: "passing" },
    };
    const { bb, harness } = host(options);
    await plugin(bb);

    await harness.behavior.callRpc("mergePr", { threadId: "t1" });
    // GitHub now returns the PR as merged; the squash left the local
    // branch's old SHAs "ahead" — HEAD and aheadCount haven't changed. The
    // cache primed by mergePr answers without any git run.
    options.pr = { outcome: "available", state: "merged" };

    expect(await harness.behavior.callRpc("prState", { threadId: "t1" })).toEqual({
      visible: false,
      reason: "already-merged",
      prUrl: "https://x",
      nextNumber: null,
    });
  });

  it("a new commit after the merge (different HEAD) → the PR button is visible again", async () => {
    const options: Parameters<typeof host>[0] = {
      environmentId: "env1",
      status: { hasUncommittedChanges: false, aheadCount: 8, headSha: "sha-1" },
      pr: { outcome: "available", state: "open", checksState: "passing" },
    };
    const { bb, harness } = host(options);
    await plugin(bb);

    await harness.behavior.callRpc("mergePr", { threadId: "t1" });
    options.pr = { outcome: "available", state: "merged" };
    options.status = { hasUncommittedChanges: false, aheadCount: 1, headSha: "sha-2" };

    expect(await harness.behavior.callRpc("prState", { threadId: "t1" })).toEqual({
      visible: true,
      reason: "content-unknown",
      prUrl: "https://x",
      nextNumber: null,
    });
  });
});

describe("mergePr", () => {
  it("merges an open PR via bb (squash) and returns ok", async () => {
    const calls: unknown[] = [];
    const { bb, harness } = host({
      environmentId: "env1",
      path: "/tmp/worktree",
      pr: { outcome: "available", state: "open", checksState: "passing" },
      mergePullRequest: async () => {
        calls.push("called");
        return { ok: true, action: "pull_request_merge" };
      },
    });
    await plugin(bb);
    // env.path in the fake host is a nonexistent directory, so the real-git
    // main pull refuses right away; that doesn't undo the merge itself. The
    // main-pull outcome no longer rides the merge result — it only lands in KV,
    // checked separately by describe("mainPullState").
    const result = await harness.behavior.callRpc("mergePr", { threadId: "t1" });
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("the thread has no environment → throws", async () => {
    const { bb, harness } = host({ environmentId: null });
    await plugin(bb);
    await expect(harness.behavior.callRpc("mergePr", { threadId: "t1" })).rejects.toThrow();
  });

  // Previously the Merge/PR buttons only learned about a freshly merged PR
  // via "changed" from environment:changed/thread:changed or via the
  // 20-second poll (app.tsx) — hence a noticeable delay before "Pull
  // Request" switched to "Merge". mergePr now publishes "changed" itself,
  // right on success.
  it("publishes \"changed\" right on success — the front end doesn't wait for polling", async () => {
    const { bb, harness } = host({
      environmentId: "env1",
      pr: { outcome: "available", state: "open", checksState: "passing" },
    });
    await plugin(bb);
    await harness.behavior.callRpc("mergePr", { threadId: "t1" });
    const changed = harness.realtimeSignals.filter((signal) => signal.channel === "changed");
    expect(changed).toHaveLength(1);
  });

  // mergePullRequest reports a refused merge as a value now (so the version
  // bump made before it is not lost with the rejection) — but the plain Merge
  // button keeps its own promise: it either merged the PR or it did not.
  it("a merge GitHub refuses is a rejection, and publishes nothing", async () => {
    const { bb, harness } = host({
      environmentId: "env1",
      pr: { outcome: "available", state: "open", checksState: "passing" },
      mergePullRequest: async () => {
        throw new Error("HTTP 409: Pull request is not currently mergeable");
      },
    });
    await plugin(bb);
    await expect(harness.behavior.callRpc("mergePr", { threadId: "t1" })).rejects.toThrow(/409/);
    expect(harness.realtimeSignals.filter((signal) => signal.channel === "changed")).toHaveLength(0);
  });
});

// The dropdown twin of the plain "Merge" button: merge, mark the linked
// task(s) done, archive the thread. Unlike createMergeArchivePr — whose
// happy path needs a real GitHub to open the PR first — this one is fully
// reachable in the harness, so the sequencing itself is checked here: a
// merge that throws never reaches the archive.
describe("mergeArchivePr", () => {
  const readyOptions = {
    environmentId: "env1",
    pr: { outcome: "available", state: "open", checksState: "passing" },
  } as const;

  it("merges the PR and then archives the thread", async () => {
    const calls: unknown[] = [];
    const { bb, harness } = host({
      ...readyOptions,
      archive: async () => {
        calls.push("called");
        return { ok: true };
      },
    });
    await plugin(bb);
    const result = await harness.behavior.callRpc("mergeArchivePr", { threadId: "t1" });
    expect(result.ok).toBe(true);
    expect(result.archived).toBe(true);
    expect(result.doneTasks).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  // The whole reason this is one RPC and not two calls from the front end:
  // a refused merge must leave the thread open, with its "Merge" button
  // still there, instead of archiving a branch that never landed.
  it("a merge that fails stops before archiving — the thread stays open", async () => {
    const calls: unknown[] = [];
    const { bb, harness } = host({
      ...readyOptions,
      mergePullRequest: async () => {
        throw new Error("merge conflict");
      },
      archive: async () => {
        calls.push("called");
        return { ok: true };
      },
    });
    await plugin(bb);
    await expect(
      harness.behavior.callRpc("mergeArchivePr", { threadId: "t1" }),
    ).rejects.toThrow(/merge conflict/);
    expect(calls).toHaveLength(0);
  });

  it("the thread has no environment → throws, archives nothing", async () => {
    const calls: unknown[] = [];
    const { bb, harness } = host({
      environmentId: null,
      archive: async () => {
        calls.push("called");
        return { ok: true };
      },
    });
    await plugin(bb);
    await expect(harness.behavior.callRpc("mergeArchivePr", { threadId: "t1" })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("publishes \"changed\" right on success — the front end doesn't wait for polling", async () => {
    const { bb, harness } = host(readyOptions);
    await plugin(bb);
    await harness.behavior.callRpc("mergeArchivePr", { threadId: "t1" });
    const changed = harness.realtimeSignals.filter((signal) => signal.channel === "changed");
    expect(changed).toHaveLength(1);
  });

  // The mirror image of the refused merge above: by the time the archive runs
  // the merge has landed on GitHub, so its refusal must not come back as a
  // rejection — that would throw away the news of a merge that DID happen.
  it("an archive that refuses after the merge → the merge is still reported, with the failed leg named", async () => {
    const { bb, harness } = host({
      ...readyOptions,
      archive: async () => {
        throw new Error("the thread is already archived");
      },
    });
    await plugin(bb);
    const result = await harness.behavior.callRpc("mergeArchivePr", { threadId: "t1" });
    expect(result.ok).toBe(true);
    expect(result.archived).toBe(false);
    expect(result.failure).toEqual({
      step: "archive",
      message: "the thread is already archived",
    });
  });
});

describe("createPr — the merge-base gate", () => {
  // The happy path runs gatherAndCreate against the real GitHub API
  // (unreachable in the harness); what can be exercised here is the gate
  // between bb's status and GitHub. `path` points nowhere on purpose: the
  // content check shells out to git there, fails, and answers "unknown",
  // which the visibility decision tolerates.
  const ready = {
    environmentId: "env1",
    path: "/nonexistent/worktree",
    branchName: "task",
    pr: { outcome: "absent" as const },
  };

  it("bb resolved no merge-base → a clear error, before any GitHub call", async () => {
    const { bb, harness } = host({
      ...ready,
      status: { hasUncommittedChanges: false, aheadCount: 1, baseRef: null },
    });
    await plugin(bb);
    await expect(harness.behavior.callRpc("createPr", { threadId: "t1" })).rejects.toThrow(
      /did not resolve the merge-base of task with origin\/main/,
    );
  });

  it("a branch name in baseRef instead of a sha is refused the same way", async () => {
    const { bb, harness } = host({
      ...ready,
      status: { hasUncommittedChanges: false, aheadCount: 1, baseRef: "origin/main" },
    });
    await plugin(bb);
    await expect(harness.behavior.callRpc("createPr", { threadId: "t1" })).rejects.toThrow(
      /did not resolve the merge-base/,
    );
  });

  it("a full sha passes the gate (the run then fails on the next step — reading origin — not on the merge-base)", async () => {
    const { bb, harness } = host({
      ...ready,
      status: {
        hasUncommittedChanges: false,
        aheadCount: 1,
        baseRef: "d181e887f29b63f7cb054af63f09817518076ea0",
      },
    });
    await plugin(bb);
    await expect(harness.behavior.callRpc("createPr", { threadId: "t1" })).rejects.not.toThrow(
      /merge-base/,
    );
  });
});

describe("createAndMergePr", () => {
  it("the thread has no environment → throws before touching GitHub", async () => {
    const { bb, harness } = host({ environmentId: null });
    await plugin(bb);
    await expect(
      harness.behavior.callRpc("createAndMergePr", { threadId: "t1" }),
    ).rejects.toThrow();
  });
});

describe("createMergeArchivePr", () => {
  // Same testable seam as createAndMergePr: the happy path runs gatherAndCreate
  // against the real GitHub API (unreachable in the harness), so the branch we
  // can exercise here is the pre-flight guard. Unlike archiveThread, this
  // handler doesn't call the archiveThread RPC — it calls markLinkedTasksStatus
  // directly before its own `threads.archive` — so the happy-path done-marking
  // isn't covered by the archiveThread describe above; it can't be reached
  // here either, since gatherAndCreate needs real GitHub. A failed/conflicting
  // merge can't reach archive or done-marking because the handler returns
  // early on `merged.failure` before either of them.
  it("the thread has no environment → throws before touching GitHub, archives nothing", async () => {
    const calls: unknown[] = [];
    const { bb, harness } = host({
      environmentId: null,
      archive: async () => {
        calls.push("called");
        return { ok: true };
      },
    });
    await plugin(bb);
    await expect(
      harness.behavior.callRpc("createMergeArchivePr", { threadId: "t1" }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

// bb itself doesn't learn about a PR status change on GitHub instantly (see
// memory/decisions/republish-catchup-burst-after-mutation.md): a single
// republish() right after the mutation often reads bb's cache before it has
// caught up, and without a safety net the button would wait for the
// front end's 20-second poll. We check that after a mutation "changed"
// arrives not once, but as a short burst.
describe("catch-up republish burst after a mutation (createPr/fastForward/mergePr)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("mergePr → \"changed\" right away and a few more times over the next seconds", async () => {
    const { bb, harness } = host({
      environmentId: "env1",
      pr: { outcome: "available", state: "open", checksState: "passing" },
    });
    await plugin(bb);

    await harness.behavior.callRpc("mergePr", { threadId: "t1" });
    const changedCount = () =>
      harness.realtimeSignals.filter((signal) => signal.channel === "changed").length;

    expect(changedCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(changedCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(changedCount()).toBe(5);
  });

  it("after the plugin is disposed, the pending republishes do not fire", async () => {
    const { bb, harness } = host({
      environmentId: "env1",
      pr: { outcome: "available", state: "open", checksState: "passing" },
    });
    await plugin(bb);
    await harness.behavior.callRpc("mergePr", { threadId: "t1" });
    await harness.dispose();

    await vi.advanceTimersByTimeAsync(20_000);
    const changed = harness.realtimeSignals.filter((signal) => signal.channel === "changed");
    expect(changed).toHaveLength(1);
  });
});

describe("mainPullState (wiring)", () => {
  it("PR not merged yet → no attempt was made", async () => {
    const { bb, harness } = host({ environmentId: "env1" });
    await plugin(bb);
    expect(await harness.behavior.callRpc("mainPullState", { threadId: "t1" })).toEqual({
      attempted: false,
      ok: true,
      reason: null,
    });
  });

  it("the thread has no environment → no attempt was made", async () => {
    const { bb, harness } = host({ environmentId: null });
    await plugin(bb);
    expect(await harness.behavior.callRpc("mainPullState", { threadId: "t1" })).toEqual({
      attempted: false,
      ok: true,
      reason: null,
    });
  });

  // env.path in the fake host is a nonexistent directory, so real git
  // inevitably refuses here; the actual logic of fetch origin
  // <base>:<base> (fast-forward-only + refusal on a branch busy in another
  // worktree) is verified separately, without real git, in
  // src/wiring/local-main-pull.test.ts. Here we only check the mergePr →
  // KV → mainPullState wiring.
  it("after mergePr, the main-pull attempt is reflected in mainPullState", async () => {
    const { bb, harness } = host({
      environmentId: "env1",
      path: "/tmp/worktree",
      pr: { outcome: "available", state: "open", checksState: "passing" },
    });
    await plugin(bb);
    await harness.behavior.callRpc("mergePr", { threadId: "t1" });

    const state = await harness.behavior.callRpc("mainPullState", { threadId: "t1" });
    expect(state.attempted).toBe(true);
    expect(state.ok).toBe(false);
    expect(typeof state.reason).toBe("string");
  });
});

// The "main not pulled" badge previously had no trigger to re-check state —
// KV was written once right after mergePr and never updated again, even if
// the failure reason (main busy in another copy) cleared later. See
// memory/decisions/main-pull-retry-button.md.
describe("retryMainPull (wiring)", () => {
  it("the thread has no environment → throws", async () => {
    const { bb, harness } = host({ environmentId: null });
    await plugin(bb);
    await expect(harness.behavior.callRpc("retryMainPull", { threadId: "t1" })).rejects.toThrow();
  });

  it("retries the attempt and returns the result directly (not only via mainPullState)", async () => {
    const { bb, harness } = host({ environmentId: "env1", path: "/tmp/worktree" });
    await plugin(bb);
    const result = await harness.behavior.callRpc("retryMainPull", { threadId: "t1" });
    expect(result.ok).toBe(false);
    expect(typeof result.reason).toBe("string");
  });

  it("the retry's result is reflected in mainPullState without a separate mergePr", async () => {
    const { bb, harness } = host({ environmentId: "env1", path: "/tmp/worktree" });
    await plugin(bb);
    await harness.behavior.callRpc("retryMainPull", { threadId: "t1" });

    const state = await harness.behavior.callRpc("mainPullState", { threadId: "t1" });
    expect(state.attempted).toBe(true);
    expect(state.ok).toBe(false);
  });

  it("publishes \"changed\" — the front end learns the retry's outcome without waiting for the 20-second poll", async () => {
    const { bb, harness } = host({ environmentId: "env1", path: "/tmp/worktree" });
    await plugin(bb);
    await harness.behavior.callRpc("retryMainPull", { threadId: "t1" });
    const changed = harness.realtimeSignals.filter((signal) => signal.channel === "changed");
    expect(changed.length).toBeGreaterThanOrEqual(1);
  });
});

// The one shared setting every base-reading button (Fast Forward, Pull
// Request, Merge, the "main not pulled" retry) reads through resolveBase —
// see src/core/base-branch.ts's module doc for what "origin" vs "local" mean.
describe("baseModeState / setBaseMode (wiring)", () => {
  it("nothing set yet → defaults to origin", async () => {
    const { bb, harness } = host({ environmentId: "env1" });
    await plugin(bb);
    expect(await harness.behavior.callRpc("baseModeState", { threadId: "t1" })).toEqual({
      mode: "origin",
    });
  });

  it("the thread has no environment → defaults to origin, never throws", async () => {
    const { bb, harness } = host({ environmentId: null });
    await plugin(bb);
    expect(await harness.behavior.callRpc("baseModeState", { threadId: "t1" })).toEqual({
      mode: "origin",
    });
  });

  it("setBaseMode persists the choice — a later baseModeState reads it back", async () => {
    const { bb, harness } = host({ environmentId: "env1" });
    await plugin(bb);
    expect(await harness.behavior.callRpc("setBaseMode", { threadId: "t1", mode: "local" })).toEqual({
      ok: true,
    });
    expect(await harness.behavior.callRpc("baseModeState", { threadId: "t1" })).toEqual({
      mode: "local",
    });
  });

  it("the thread has no environment → setBaseMode throws instead of writing nowhere", async () => {
    const { bb, harness } = host({ environmentId: null });
    await plugin(bb);
    await expect(
      harness.behavior.callRpc("setBaseMode", { threadId: "t1", mode: "local" }),
    ).rejects.toThrow();
  });

  it("publishes \"changed\" — the base-reading buttons refetch instead of waiting on the 20-second poll", async () => {
    const { bb, harness } = host({ environmentId: "env1" });
    await plugin(bb);
    await harness.behavior.callRpc("setBaseMode", { threadId: "t1", mode: "local" });
    const changed = harness.realtimeSignals.filter((signal) => signal.channel === "changed");
    expect(changed.length).toBeGreaterThanOrEqual(1);
  });

  it("mode local reaches environments.status as the bare branch name, not origin/<x>", async () => {
    const { bb, harness } = host({
      environmentId: "env1",
      status: { hasUncommittedChanges: false, aheadCount: 0, behindCount: 3 },
    });
    await plugin(bb);
    await harness.behavior.callRpc("setBaseMode", { threadId: "t1", mode: "local" });
    await harness.behavior.callRpc("fastForwardState", { threadId: "t1" });

    const statusCalls = harness.inspection.sdk.callsTo("environments.status") as Array<
      [{ mergeBaseBranch?: string }]
    >;
    const lastCall = statusCalls[statusCalls.length - 1][0];
    expect(lastCall.mergeBaseBranch).toBe("main");
  });
});

// The subscription shell: the server asks the front end to refetch
// ("changed") on any environment change, and on a thread change only when
// the environment link changed (a PR appeared/changed), not on
// status-heartbeats.
type ChangeEvent = { changes: readonly string[] };
type SubscribeCall = [{ event: string; callback: (event: ChangeEvent) => void }];

async function subscriptions() {
  const { bb, harness } = createFakePluginHost({
    pluginId: "pull-request",
    sdk: { subscribe: () => () => {} },
  });
  await plugin(bb);
  const calls = harness.inspection.sdk.callsTo("subscribe") as SubscribeCall[];
  const callbackFor = (event: string) => {
    const call = calls.find((args) => args[0].event === event);
    if (!call) throw new Error(`no subscription for ${event}`);
    return call[0].callback;
  };
  const changedCount = () =>
    harness.realtimeSignals.filter((signal) => signal.channel === "changed").length;
  return { callbackFor, changedCount };
}

describe("republish \"changed\" subscriptions", () => {
  it("environment:changed → refetch (any environment change)", async () => {
    const { callbackFor, changedCount } = await subscriptions();
    callbackFor("environment:changed")({ changes: ["git-refs-changed"] });
    expect(changedCount()).toBe(1);
  });

  it("thread:changed with environment-changed → refetch (bb recognized the PR)", async () => {
    const { callbackFor, changedCount } = await subscriptions();
    callbackFor("thread:changed")({ changes: ["environment-changed"] });
    expect(changedCount()).toBe(1);
  });

  it("thread:changed without environment-changed → stay quiet (heartbeats don't count)", async () => {
    const { callbackFor, changedCount } = await subscriptions();
    callbackFor("thread:changed")({ changes: ["status-changed", "title-changed"] });
    expect(changedCount()).toBe(0);
  });
});

// Triggers and actions: the machinery as rules (src/core/automation.ts).
// Every test above runs on the default rules — they are the proof that the
// defaults reproduce today's behaviour. The tests below change the rules.
describe("automation rules (wiring)", () => {
  const openPr = {
    environmentId: "env1",
    path: "/tmp/does-not-exist-worktree",
    pr: { outcome: "available", state: "open", checksState: "passing" },
  } as const;

  async function withRules(options: HostOptions, rules: unknown) {
    const { bb, harness } = host(options);
    await plugin(bb);
    await harness.behavior.callRpc("saveAutomationRules", { rules });
    return harness;
  }

  const defaults = async () => {
    const { bb, harness } = host({ environmentId: "env1" });
    await plugin(bb);
    return (await harness.behavior.callRpc("automationRules", {})).rules;
  };

  it("saving normalizes the rules, answers them, publishes them, and reads back the same", async () => {
    const { bb, harness } = host({ environmentId: "env1" });
    await plugin(bb);
    const saved = await harness.behavior.callRpc("saveAutomationRules", {
      rules: {
        version: 1,
        rules: [
          { id: "late", triggers: ["outcome.merged"], actions: ["git.pull-main"] },
          { id: "early", triggers: ["click.merge", "click.merge"], actions: ["git.merge"] },
        ],
      },
    });
    expect(saved.rules.rules.map((r: { id: string }) => r.id)).toEqual(["early", "late"]);
    expect(saved.rules.rules[0].triggers).toEqual(["click.merge"]);
    expect((await harness.behavior.callRpc("automationRules", {})).rules).toEqual(saved.rules);
    expect(harness.realtimeSignals.some((s) => s.channel === "automation-rules")).toBe(true);
  });

  it("a merge with git.pull-main taken off every rule never tries to pull main", async () => {
    const rules = await defaults();
    const harness = await withRules(openPr, {
      ...rules,
      rules: rules.rules.map((r: { id: string; actions: string[] }) => ({ ...r, actions: r.actions.filter((a) => a !== "git.pull-main") })),
    });
    await harness.behavior.callRpc("mergePr", { threadId: "t1" });
    expect((await harness.behavior.callRpc("mainPullState", { threadId: "t1" })).attempted).toBe(false);
  });

  it("git.pull-main hung on the Wake Up click pulls main on that click", async () => {
    const rules = await defaults();
    const harness = await withRules(openPr, {
      ...rules,
      rules: rules.rules.map((r: { id: string; actions: string[] }) => (r.id === "click-wake" ? { ...r, actions: ["bb.wake", "git.pull-main"] } : r)),
    });
    await harness.behavior.callRpc("wakeUp", { threadId: "t1" });
    expect((await harness.behavior.callRpc("mainPullState", { threadId: "t1" })).attempted).toBe(true);
  });

  it("without the refresh rule a merge publishes no \"changed\"", async () => {
    const rules = await defaults();
    const harness = await withRules(openPr, {
      ...rules,
      rules: rules.rules.filter((r: { id: string }) => r.id !== "outcome-mutated"),
    });
    const before = harness.realtimeSignals.filter((s) => s.channel === "changed").length;
    await harness.behavior.callRpc("mergePr", { threadId: "t1" });
    expect(harness.realtimeSignals.filter((s) => s.channel === "changed")).toHaveLength(before);
  });

  it("a Pull Request click whose rule lost git.create-pr is refused by name", async () => {
    const rules = await defaults();
    const harness = await withRules(openPr, {
      ...rules,
      rules: rules.rules.map((r: { id: string }) => (r.id === "click-pr" ? { ...r, actions: ["bb.tasks-in-review"] } : r)),
    });
    await expect(harness.behavior.callRpc("createPr", { threadId: "t1" })).rejects.toThrow(/Создать PR/);
  });

});

describe("automation rules, version 2 (wiring)", () => {
  it("an empty store answers the default rules, notifications and one row per button included", async () => {
    const { bb, harness } = host({ environmentId: "env1" });
    await plugin(bb);
    const { rules } = await harness.behavior.callRpc("automationRules", {});
    expect(rules.version).toBe(2);
    expect(rules.rules.find((r: { id: string }) => r.id === "click-merge").actions).toContain("notify.errors");
    expect(rules.rules.find((r: { id: string }) => r.id === "state-show-row-glyph").triggers).toEqual(["state.poll"]);
  });

  it("the glyph row without the 20-second poll answers no glyph", async () => {
    const { bb, harness } = host({ environmentId: "env1", status: { hasUncommittedChanges: true, aheadCount: 1 } });
    await plugin(bb);
    const { rules } = await harness.behavior.callRpc("automationRules", {});
    await harness.behavior.callRpc("saveAutomationRules", {
      rules: { ...rules, rules: rules.rules.map((r: { id: string }) => (r.id === "state-show-row-glyph" ? { ...r, triggers: ["state.env"] } : r)) },
    });
    expect(await harness.behavior.callRpc("rowFacts", { threadId: "t1" })).toEqual({ gitPhase: "unknown", pr: null });
  });

  it("the agent tools read the catalog and rules, and save or reset them", async () => {
    const { bb, harness } = host({ environmentId: "env1" });
    await plugin(bb);
    const defaults = (await harness.behavior.callRpc("automationRules", {})).rules;
    const read = String(await harness.callAgentTool("pr_automation_read", {}));
    expect(read).toContain("notify.result");
    expect(read).toContain("Смёрджить PR");
    const saved = String(await harness.callAgentTool("pr_automation_save", { rules: { version: 2, rules: [{ id: "x", triggers: [], actions: ["bb.archive"] }] } }));
    expect(saved).toContain("Нет триггера");
    expect((await harness.behavior.callRpc("automationRules", {})).rules.rules).toHaveLength(1);
    await harness.callAgentTool("pr_automation_save", { reset: true });
    expect((await harness.behavior.callRpc("automationRules", {})).rules).toEqual(defaults);
  });
});

describe("thread status rules (wiring)", () => {
  it("rowFacts with every status taken off the rules answers no icon, whatever git says", async () => {
    const { bb, harness } = host({ environmentId: "env1", status: { hasUncommittedChanges: true, aheadCount: 1 } });
    await plugin(bb);
    const { rules } = await harness.behavior.callRpc("automationRules", {});
    await harness.behavior.callRpc("saveAutomationRules", {
      rules: { ...rules, rules: rules.rules.map((r: { actions: string[] }) => ({ ...r, actions: r.actions.filter((a) => !a.startsWith("status.")) })) },
    });
    expect(await harness.behavior.callRpc("rowFacts", { threadId: "t1" })).toEqual({ gitPhase: "unknown", pr: null });
  });
});
