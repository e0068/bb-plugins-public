import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

// A thin integration test of the prState wiring: runs the real rpc contract
// over a stubbed bb.sdk and checks that the environment's git status and PR
// state correctly resolve into the button's visibility decision.

interface StatusStub {
  hasUncommittedChanges: boolean;
  aheadCount: number;
  behindCount?: number;
  /** The current branch's HEAD — fixed by default, so a merge can recognize "the same commit". */
  headSha?: string;
}

type PrState = "open" | "draft" | "merged" | "closed";
type ChecksState = "failing" | "no_checks" | "passing" | "pending" | "unknown";

interface HostOptions {
  environmentId: string | null;
  status?: StatusStub;
  pr?: {
    outcome: "absent" | "available" | "unavailable";
    url?: string;
    number?: number;
    state?: PrState;
    checksState?: ChecksState;
  };
  prThrows?: boolean;
  mergePullRequest?: () => Promise<unknown>;
  unarchive?: () => Promise<unknown>;
  /** The environment's lifecycle status. Defaults to "ready". */
  environmentStatus?: "destroyed" | "destroying" | "error" | "provisioning" | "ready" | "retiring";
  /**
   * The environment's working copy. `null` by default on purpose: the content
   * check (src/wiring/merged-content.ts) shells out to real git when there is
   * a path, and these tests are about the wiring, not about git. Tests that
   * need the real-git path — the local main pull — pass one explicitly.
   */
  path?: string | null;
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
        },
      }
    : { outcome: pr?.outcome ?? "absent" };
}

function host(options: HostOptions) {
  return createFakePluginHost({
    pluginId: "pull-request",
    sdk: {
      subscribe: () => () => {},
      threads: {
        get: async () => ({ environmentId: options.environmentId }),
        unarchive: options.unarchive ?? (async () => ({ ok: true })),
      },
      environments: {
        get: async () => ({
          mergeBaseBranch: null,
          defaultBranch: "main",
          baseBranch: "origin/main",
          path: options.path ?? null,
          status: options.environmentStatus ?? "ready",
        }),
        status: async () => statusResultOf(options.status),
        pullRequest: async () => {
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

describe("prState (wiring)", () => {
  it("clean + ahead of base + PR absent → visible", async () => {
    expect(
      await prState({
        environmentId: "env1",
        status: { hasUncommittedChanges: false, aheadCount: 2 },
        pr: { outcome: "absent" },
      }),
    ).toEqual({ visible: true, reason: "ready", prUrl: null, nextNumber: null });
  });

  // The one place where the wiring meets real git: with a working copy on
  // disk the content check actually shells out. The path here doesn't exist,
  // so git refuses — and a refusal must not withhold the button, since
  // "couldn't measure" is not "already merged". The same missing path also
  // makes the nextNumber preview (readOrigin) fail closed to null, without
  // ever touching a token or the network.
  it("git can't answer (a working copy that isn't there) → still visible", async () => {
    expect(
      await prState({
        environmentId: "env1",
        path: "/tmp/does-not-exist-worktree",
        status: { hasUncommittedChanges: false, aheadCount: 2 },
        pr: { outcome: "absent" },
      }),
    ).toEqual({ visible: true, reason: "ready", prUrl: null, nextNumber: null });
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
      reason: "ready",
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
      reason: "ready",
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
    // main pull refuses right away; that doesn't undo the merge itself.
    // The content of mainPull is checked separately by describe("mainPullState").
    const result = await harness.behavior.callRpc("mergePr", { threadId: "t1" });
    expect(result.ok).toBe(true);
    expect(result.mainPull).toEqual({ ok: false, reason: expect.any(String) });
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
