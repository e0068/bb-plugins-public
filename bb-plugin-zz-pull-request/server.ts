// bb-plugin-zz-pull-request — the plugin entry point (Layer 3, wiring only).
//
// Gives the front end two RPCs: prState (whether to show the button) and
// createPr (open a PR on GitHub via the API without a push). All the logic
// lives in the layers below: the pure core (src/core) and the GitHub-flow
// orchestrator (src/wiring/create-pr). This file reads the world through
// bb.sdk and wires it together.
import { defineRpcContract, type BbPluginApi, type PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { decideArchiveVisible } from "./src/core/archive-readiness";
import { resolveBase } from "./src/core/base-branch";
import { isDeletion } from "./src/core/changed-files";
import { decideFastForward } from "./src/core/fast-forward";
import {
  configPathFromGitdir,
  originUrlFromGitConfig,
  parseGitdirPointer,
} from "./src/core/git-config";
import type { ChangedFile, RepoRef } from "./src/core/github-requests";
import {
  decideMergeReadiness,
  type ChecksState,
  type MergeIndicator,
  type PrState,
} from "./src/core/merge-readiness";
import { parseGithubRemote } from "./src/core/remote";
import { decideWakeUpVisible } from "./src/core/retiring";
import { threadChangeTouchesPr } from "./src/core/thread-change";
import { chooseToken } from "./src/core/token";
import { type PrPresence } from "./src/core/visibility";
import { runCreatePr } from "./src/wiring/create-pr";
import { liveAheadCount, runFastForward } from "./src/wiring/fast-forward";
import { ghAuthToken } from "./src/wiring/gh-token";
import { gitClient } from "./src/wiring/git-client";
import { githubClient } from "./src/wiring/github-client";
import { runLocalMainPull, type LocalMainPullResult } from "./src/wiring/local-main-pull";
import { fetchNextPrNumber } from "./src/wiring/next-pr-number";
import { checkMergedContent } from "./src/wiring/merged-content";
import {
  resolveVisibility,
  type VisibilityPorts,
  type VisibilityWorkspace,
} from "./src/wiring/visibility-decision";

export const rpcContract = defineRpcContract({
  prState: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({
      visible: z.boolean(),
      reason: z.string(),
      prUrl: z.string().nullable(),
      // Best-effort preview of the number GitHub will assign the PR, shown
      // on the button before the click. `null` when it couldn't be
      // determined (no working copy, no token, GitHub unreachable) — the
      // button still works, it just shows no number.
      nextNumber: z.number().nullable(),
    }),
  },
  createPr: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ url: z.string(), number: z.number() }),
  },
  createAndMergePr: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({
      url: z.string(),
      number: z.number(),
      mainPull: z.object({ ok: z.boolean(), reason: z.string().nullable() }).nullable(),
    }),
  },
  createMergeArchivePr: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({
      url: z.string(),
      number: z.number(),
      mainPull: z.object({ ok: z.boolean(), reason: z.string().nullable() }).nullable(),
      archived: z.boolean(),
    }),
  },
  fastForwardState: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ visible: z.boolean(), reason: z.string() }),
  },
  fastForward: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  mergeState: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({
      visible: z.boolean(),
      indicator: z.enum(["success", "failure", "pending", "neutral", "unknown"]),
      prUrl: z.string().nullable(),
      // The PR number to show on the Merge button, so it's clear which PR
      // will be merged. `null` when it couldn't be determined.
      number: z.number().nullable(),
    }),
  },
  mergePr: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({
      ok: z.boolean(),
      // The result of trying to pull the local main in the same pass — the
      // front end marks success with a toast, symmetric with retryMainPull
      // (see app.tsx). `null` when there was nothing to pull (no path/base branch).
      mainPull: z.object({ ok: z.boolean(), reason: z.string().nullable() }).nullable(),
    }),
  },
  mainPullState: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({
      attempted: z.boolean(),
      ok: z.boolean(),
      reason: z.string().nullable(),
    }),
  },
  retryMainPull: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ ok: z.boolean(), reason: z.string().nullable() }),
  },
  wakeUpState: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ visible: z.boolean() }),
  },
  wakeUp: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
  archiveState: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ visible: z.boolean(), reason: z.string() }),
  },
  archiveThread: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({ ok: z.boolean() }),
  },
});

type Sdk = BbPluginApi["sdk"];
type FileRead = { content: string; contentEncoding: "base64" | "utf8" };

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    githubToken: {
      type: "string",
      // By default the token comes from `gh auth token` on the bb machine;
      // the setting is an optional override (e.g. when gh isn't logged in).
      label: "GitHub token (optional; defaults to gh auth token)",
      secret: true,
    },
  });

  // Prompts the front end to refetch prState from two sources of truth:
  // - environment:changed — a commit/branch change/git-refs change the git status;
  // - thread:changed(environment-changed) — bb recognized/changed the thread's PR;
  //   without this subscription, the row would only update on an interface reload.
  const republish = () => bb.realtime.publish("changed", {});

  // Mutating RPCs (createPr/fastForward/mergePr) call not plain republish(),
  // but republishAfterMutation(): right after the mutation,
  // `sdk.environments.pullRequest`/`status` on bb's SIDE haven't yet caught
  // up with GitHub (bb itself doesn't learn about the change instantly, see
  // memory/wiki/pr-plugin-live-refresh-event.md) — the first refetch often
  // reads the same stale state, and without a safety net the button would
  // wait for the next event or up to POLL_INTERVAL_MS (20s) in app.tsx,
  // which stretched the PR → Merge switch to about 30 seconds (see
  // memory/decisions/republish-catchup-burst-after-mutation.md). Rather than
  // keeping the general polling short for every idle thread, we send a
  // short burst of repeated republish() calls exactly during the seconds
  // when we OURSELVES know the state is about to catch up.
  const REPUBLISH_CATCHUP_DELAYS_MS = [1000, 3000, 6000, 12000];
  const pendingCatchupTimers = new Set<ReturnType<typeof setTimeout>>();
  function republishAfterMutation(): void {
    republish();
    for (const delay of REPUBLISH_CATCHUP_DELAYS_MS) {
      const timer = setTimeout(() => {
        pendingCatchupTimers.delete(timer);
        republish();
      }, delay);
      timer.unref?.();
      pendingCatchupTimers.add(timer);
    }
  }
  bb.onDispose(() => {
    for (const timer of pendingCatchupTimers) clearTimeout(timer);
    pendingCatchupTimers.clear();
  });

  bb.rpc.register(rpcContract, {
    async prState({ threadId }) {
      return computePrState(bb.sdk, bb.storage.kv, settings, threadId);
    },
    async createPr({ threadId }) {
      const token = await resolveToken(settings);
      const result = await gatherAndCreate(bb.sdk, bb.storage.kv, token, threadId);
      republishAfterMutation();
      return result;
    },
    // A composition of createPr and mergePr's own logic, no new decision-making:
    // opens the PR (gatherAndCreate), then merges it the same way the "Merge"
    // button does (mergePullRequest resolves the PR by re-reading GitHub, same
    // path lookupPullRequest uses — not by any local id createPr just returned).
    // If the merge leg throws, the PR still exists and surfaces its own "Merge"
    // button on the next refetch — nothing is silently lost.
    async createAndMergePr({ threadId }) {
      const token = await resolveToken(settings);
      const created = await gatherAndCreate(bb.sdk, bb.storage.kv, token, threadId);
      await sleep(CREATE_TO_MERGE_PAUSE_MS);
      const merged = await mergePullRequest(bb.sdk, bb.storage.kv, threadId);
      republishAfterMutation();
      return { url: created.url, number: created.number, mainPull: merged.mainPull };
    },
    // Extends createAndMergePr with a final archive step, still no new
    // decision-making: mergePullRequest THROWS on a conflict/failed merge, so
    // reaching the archive line already proves the merge landed cleanly — the
    // "if everything went smoothly" gate is the absence of a throw, not a
    // re-read of bb's (post-merge stale) state. The best-effort local main
    // pull inside mergePullRequest never fails the merge, so it never blocks
    // archiving either — it's surfaced by its own toast, same as elsewhere.
    async createMergeArchivePr({ threadId }) {
      const token = await resolveToken(settings);
      const created = await gatherAndCreate(bb.sdk, bb.storage.kv, token, threadId);
      await sleep(CREATE_TO_MERGE_PAUSE_MS);
      const merged = await mergePullRequest(bb.sdk, bb.storage.kv, threadId);
      await bb.sdk.threads.archive({ threadId });
      republishAfterMutation();
      return {
        url: created.url,
        number: created.number,
        mainPull: merged.mainPull,
        archived: true,
      };
    },
    async fastForwardState({ threadId }) {
      return computeFastForwardState(bb.sdk, threadId);
    },
    async fastForward({ threadId }) {
      // republish runs on failure too (finally, not just after the return):
      // a refusal here means the live check just found the branch already
      // diverged — exactly the state fastForwardState's own cache was
      // trusting when it showed the button. Without this, the button stayed
      // "ready" until the next 20s poll and every click in between repeated
      // the same failure.
      try {
        return await fastForwardBranch(bb.sdk, threadId);
      } finally {
        republishAfterMutation();
      }
    },
    async mergeState({ threadId }) {
      return computeMergeState(bb.sdk, threadId);
    },
    async mergePr({ threadId }) {
      const result = await mergePullRequest(bb.sdk, bb.storage.kv, threadId);
      republishAfterMutation();
      return result;
    },
    async mainPullState({ threadId }) {
      return computeMainPullState(bb.sdk, bb.storage.kv, threadId);
    },
    async retryMainPull({ threadId }) {
      const environmentId = await environmentIdOf(bb.sdk, threadId);
      if (!environmentId) throw new Error("The thread has no environment with git.");
      const pull = await attemptLocalMainPull(bb.sdk, bb.storage.kv, environmentId);
      if (!pull) {
        throw new Error("The environment has no working copy or base branch — nothing to pull.");
      }
      republishAfterMutation();
      return normalizeMainPull(pull);
    },
    async wakeUpState({ threadId }) {
      return computeWakeUpState(bb.sdk, threadId);
    },
    // threads.unarchive is a real, idempotent SDK action (fine to call on an
    // already-unarchived thread — it just re-sets archivedAt to null); on an
    // environment stuck "retiring" it also cancels that retire as a side
    // effect of bb's own unarchive route, before any live command reaches the
    // provider (the route re-checks the environment is already "ready" before
    // forwarding anything, so a retiring one is a pure state fix — no agent
    // turn starts, no message is added).
    async wakeUp({ threadId }) {
      await bb.sdk.threads.unarchive({ threadId });
      republishAfterMutation();
      return { ok: true };
    },
    async archiveState({ threadId }) {
      return computeArchiveState(bb.sdk, bb.storage.kv, threadId);
    },
    async archiveThread({ threadId }) {
      await bb.sdk.threads.archive({ threadId });
      republishAfterMutation();
      return { ok: true };
    },
  });

  const unsubscribeEnv = bb.sdk.subscribe({
    event: "environment:changed",
    callback: republish,
  });
  const unsubscribeThread = bb.sdk.subscribe({
    event: "thread:changed",
    callback: (event) => {
      if (threadChangeTouchesPr(event.changes)) republish();
    },
  });
  bb.onDispose(unsubscribeEnv);
  bb.onDispose(unsubscribeThread);

  bb.log.info("pull-request loaded");
}

async function computePrState(
  sdk: Sdk,
  kv: PluginKvStorage,
  settings: GithubTokenSettings,
  threadId: string,
): Promise<{ visible: boolean; reason: string; prUrl: string | null; nextNumber: number | null }> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) {
    return { visible: false, reason: "no-environment", prUrl: null, nextNumber: null };
  }

  const env = await sdk.environments.get({ environmentId });
  const base = resolveBase(env);
  if (!base) return { visible: false, reason: "no-base-branch", prUrl: null, nextNumber: null };

  // Without an explicit base, bb doesn't compute mergeBase (and with it
  // aheadCount) — the button would then always hide as "nothing to PR". We
  // compute against the REMOTE base (base.statusBase), otherwise a stale
  // local main produces a phantom ahead.
  const status = await sdk.environments.status({
    environmentId,
    mergeBaseBranch: base.statusBase,
  });
  if (status.outcome !== "available") {
    return { visible: false, reason: `status-${status.outcome}`, prUrl: null, nextNumber: null };
  }

  const pr = await lookupPullRequest(sdk, environmentId);
  const decision = await resolveVisibility(
    visibilityPorts(kv, environmentId, env.path, base.githubBase),
    { workspace: visibilityWorkspace(status.workspace), pr: pr.presence },
  );
  if (!decision.visible) {
    return { visible: false, reason: decision.reason, prUrl: pr.url, nextNumber: null };
  }

  const nextNumber = await peekNextPrNumber(sdk, settings, env);
  return { visible: true, reason: decision.reason, prUrl: pr.url, nextNumber };
}

// Best-effort preview of the button's number, shown before the click. Needs
// a working copy on disk (to read origin) and a token — either missing, or
// GitHub unreachable, degrades to no number rather than failing prState or
// hiding the button: the number is a label, not something the button's
// visibility depends on. Reads the repo before the token, so the common
// case of "no working copy on disk" never touches `gh`/settings at all.
async function peekNextPrNumber(
  sdk: Sdk,
  settings: GithubTokenSettings,
  env: { hostId: string; path: string | null },
): Promise<number | null> {
  if (!env.path) return null;
  try {
    const repo = await readOrigin(sdk, env.hostId, env.path);
    const token = await resolveToken(settings);
    return await fetchNextPrNumber(githubClient(token), repo);
  } catch {
    return null;
  }
}

// The ports for resolveVisibility: KV as the cache of the measured fact, git
// as the measurement itself. The order in which they are consulted lives in
// src/wiring/visibility-decision.ts.
function visibilityPorts(
  kv: PluginKvStorage,
  environmentId: string,
  path: string | null,
  base: string,
): VisibilityPorts {
  return {
    cachedHeadMatches: (headSha) => wasHeadAlreadyMerged(kv, environmentId, headSha),
    rememberMerged: (headSha) => kv.set(mergedHeadKey(environmentId), headSha),
    // Without a working copy on disk there is nothing to run git in, and the
    // question stays unanswered rather than being guessed at.
    measure: async () => (path ? checkMergedContent(gitClient(path), base) : "unknown"),
  };
}

function visibilityWorkspace(workspace: {
  checkout: WorkspaceCheckout;
  workingTree: { hasUncommittedChanges: boolean };
  mergeBase: { aheadCount: number } | null;
}): VisibilityWorkspace {
  return {
    headSha: checkoutHeadSha(workspace.checkout),
    hasUncommittedChanges: workspace.workingTree.hasUncommittedChanges,
    aheadCount: workspace.mergeBase?.aheadCount ?? 0,
  };
}

async function computeWakeUpState(sdk: Sdk, threadId: string): Promise<{ visible: boolean }> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) return { visible: false };

  const env = await sdk.environments.get({ environmentId });
  return { visible: decideWakeUpVisible(env.status) };
}

// Cheap-first: an unmerged PR answers without ever touching environments.status
// — same economy as peekNextPrNumber avoiding gh for a missing working copy.
// Only once the PR is merged do we pay for the working-tree and "un-landed
// commits" checks that keep Archive from showing next to another button.
async function computeArchiveState(
  sdk: Sdk,
  kv: PluginKvStorage,
  threadId: string,
): Promise<{ visible: boolean; reason: string }> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) return { visible: false, reason: "no-environment" };

  const pr = await lookupPullRequest(sdk, environmentId);
  if (pr.state !== "merged") return { visible: false, reason: "not-merged" };

  const env = await sdk.environments.get({ environmentId });
  const base = resolveBase(env);
  // With a base we read aheadCount too, so the "Pull Request" visibility below
  // can tell landed-and-done from new commits waiting for a fresh PR.
  const status = await sdk.environments.status(
    base ? { environmentId, mergeBaseBranch: base.statusBase } : { environmentId },
  );
  if (status.outcome !== "available") {
    return { visible: false, reason: `status-${status.outcome}` };
  }

  // The same fact — and the same decision — the "Pull Request" button lives on.
  // Deriving "un-landed commits" from it guarantees Archive and Pull Request are
  // never shown at once. Without a base there's nothing ahead to compare against,
  // and the Pull Request button is hidden anyway, so there's no un-landed work.
  const createPr = base
    ? await resolveVisibility(
        visibilityPorts(kv, environmentId, env.path, base.githubBase),
        { workspace: visibilityWorkspace(status.workspace), pr: pr.presence },
      )
    : null;

  return decideArchiveVisible({
    prState: pr.state,
    hasUncommittedChanges: status.workspace.workingTree.hasUncommittedChanges,
    hasUnlandedCommits: createPr?.visible ?? false,
  });
}

async function computeFastForwardState(
  sdk: Sdk,
  threadId: string,
): Promise<{ visible: boolean; reason: string }> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) return { visible: false, reason: "no-environment" };

  const env = await sdk.environments.get({ environmentId });
  const base = resolveBase(env);
  if (!base) return { visible: false, reason: "no-base-branch" };

  const status = await sdk.environments.status({
    environmentId,
    mergeBaseBranch: base.statusBase,
  });
  if (status.outcome !== "available") {
    return { visible: false, reason: `status-${status.outcome}` };
  }

  const { workingTree, mergeBase } = status.workspace;
  // The cached aheadCount can lie stale at 0 (see liveAheadCount's doc
  // comment in src/wiring/fast-forward.ts) — measure live when there's a
  // working copy to measure in, and fall back to the cache only when that
  // measurement itself is unavailable.
  const liveAhead = env.path ? await liveAheadCount(gitClient(env.path), base.githubBase) : null;
  const decision = decideFastForward({
    behindCount: mergeBase?.behindCount ?? 0,
    aheadCount: liveAhead ?? mergeBase?.aheadCount ?? 0,
    hasUncommittedChanges: workingTree.hasUncommittedChanges,
  });
  return { visible: decision.visible, reason: decision.reason };
}

async function gatherAndCreate(
  sdk: Sdk,
  kv: PluginKvStorage,
  token: string,
  threadId: string,
): Promise<{ url: string; number: number }> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) throw new Error("The thread has no environment with git.");

  const env = await sdk.environments.get({ environmentId });
  const base = resolveBase(env);
  if (!base) throw new Error("Could not determine the environment's base branch.");

  const status = await sdk.environments.status({
    environmentId,
    mergeBaseBranch: base.statusBase,
  });
  if (status.outcome !== "available") {
    throw new Error(`environment git status unavailable (${status.outcome}).`);
  }

  const pr = await lookupPullRequest(sdk, environmentId);
  const { mergeBase } = status.workspace;
  const decision = await resolveVisibility(
    visibilityPorts(kv, environmentId, env.path, base.githubBase),
    { workspace: visibilityWorkspace(status.workspace), pr: pr.presence },
  );
  if (!decision.visible || !mergeBase) {
    throw new Error(`Can't open a PR right now (${decision.reason}).`);
  }

  const path = env.path;
  if (!path) throw new Error("The environment has no working copy on disk.");
  const headBranch = env.branchName;
  if (!headBranch) throw new Error("The environment has no current branch.");

  const repo = await readOrigin(sdk, env.hostId, path);
  const files = await buildChangedFiles(sdk, env.hostId, path, mergeBase.files);
  const title =
    mergeBase.commits.length === 1 ? mergeBase.commits[0].subject : headBranch;

  return runCreatePr(githubClient(token), {
    repo,
    baseBranch: base.githubBase,
    headBranch,
    files,
    title,
    body: prBody(mergeBase.commits),
  });
}

async function fastForwardBranch(
  sdk: Sdk,
  threadId: string,
): Promise<{ ok: boolean }> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) throw new Error("The thread has no environment with git.");

  const env = await sdk.environments.get({ environmentId });
  const base = resolveBase(env);
  if (!base) throw new Error("Could not determine the environment's base branch.");

  const status = await sdk.environments.status({
    environmentId,
    mergeBaseBranch: base.statusBase,
  });
  if (status.outcome !== "available") {
    throw new Error(`environment git status unavailable (${status.outcome}).`);
  }

  const { workingTree, mergeBase } = status.workspace;
  const decision = decideFastForward({
    behindCount: mergeBase?.behindCount ?? 0,
    aheadCount: mergeBase?.aheadCount ?? 0,
    hasUncommittedChanges: workingTree.hasUncommittedChanges,
  });
  if (!decision.visible) {
    throw new Error(`Fast-forward is not possible right now (${decision.reason}).`);
  }

  const path = env.path;
  if (!path) throw new Error("The environment has no working copy on disk.");

  await runFastForward(gitClient(path), base.githubBase);
  return { ok: true };
}

async function computeMergeState(
  sdk: Sdk,
  threadId: string,
): Promise<{
  visible: boolean;
  indicator: MergeIndicator;
  prUrl: string | null;
  number: number | null;
}> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) return { visible: false, indicator: "unknown", prUrl: null, number: null };

  const pr = await lookupPullRequest(sdk, environmentId);
  if (pr.state === null || pr.checksState === null) {
    return { visible: false, indicator: "unknown", prUrl: pr.url, number: pr.number };
  }
  const decision = decideMergeReadiness({ prState: pr.state, checksState: pr.checksState });
  return { visible: decision.visible, indicator: decision.indicator, prUrl: pr.url, number: pr.number };
}

// We merge with the same method (squash) the project already uses to land a
// branch onto main — see memory/decisions/fast-forward-ff-only-safe.md. bb
// itself makes the request to GitHub (sdk.environments.mergePullRequest),
// the plugin doesn't need to build it by hand like it does for createPr.
const MERGE_METHOD = "squash";

// Don't merge right after creating: GitHub isn't ready to merge a PR that
// fresh and the merge leg fails. See
// memory/decisions/pause-between-create-and-merge.md.
const CREATE_TO_MERGE_PAUSE_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mergePullRequest(
  sdk: Sdk,
  kv: PluginKvStorage,
  threadId: string,
): Promise<{ ok: boolean; mainPull: { ok: boolean; reason: string | null } | null }> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) throw new Error("The thread has no environment with git.");

  // We capture HEAD BEFORE the merge: the merge itself is only a request to
  // the GitHub API, it doesn't touch local git, so HEAD doesn't move. Storing
  // it primes the cache described at mergedHeadKey — the button hides the
  // instant the merge goes through, without waiting for the next content
  // measurement (which needs a fetch and a fresh remote ref).
  const headSha = await currentHeadSha(sdk, environmentId);
  await sdk.environments.mergePullRequest({ environmentId, method: MERGE_METHOD });
  if (headSha) await kv.set(mergedHeadKey(environmentId), headSha);

  // The merge on GitHub has already gone through — pulling the local main
  // from here on is best-effort: a failure (main is busy with an
  // incompatible change in the target copy/has diverged) must not fail
  // mergePr, only land in KV so the front end can show the reason in the
  // Merge button's place — and offer a retry (retryMainPull) instead of
  // just waiting for the next merge. See
  // memory/decisions/local-main-pull-after-merge.md and
  // memory/decisions/main-pull-retry-button.md. We also return the result
  // directly — the front end marks success with a toast right away, without
  // waiting for the next mainPullState.
  const pull = await attemptLocalMainPull(sdk, kv, environmentId);

  return { ok: true, mainPull: pull && normalizeMainPull(pull) };
}

// Shared shape of the RPC response for the main-pull result
// (mergePr/retryMainPull): `LocalMainPullResult` doesn't carry a `reason` on
// the success branch, while the RPC's zod schema requires the field always —
// here it's normalized to a present `null`.
function normalizeMainPull(pull: LocalMainPullResult): { ok: boolean; reason: string | null } {
  return pull.ok ? { ok: true, reason: null } : { ok: false, reason: pull.reason };
}

// The shared step for mergePullRequest (best-effort right after the merge)
// and retryMainPull (an explicit retry on click): resolve the environment's
// path/base, try to pull main, and save the result to KV. Returns `null`
// when there's nothing to try (no path or base branch) — mergePullRequest
// silently skips the step at that point, retryMainPull turns it into an RPC error.
async function attemptLocalMainPull(
  sdk: Sdk,
  kv: PluginKvStorage,
  environmentId: string,
): Promise<LocalMainPullResult | null> {
  const env = await sdk.environments.get({ environmentId });
  const base = resolveBase(env);
  if (!base || !env.path) return null;

  const pull = await runLocalMainPull(gitClient(env.path), base.githubBase);
  await kv.set(localMainPullKey(environmentId), pull);
  return pull;
}

async function computeMainPullState(
  sdk: Sdk,
  kv: PluginKvStorage,
  threadId: string,
): Promise<{ attempted: boolean; ok: boolean; reason: string | null }> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) return { attempted: false, ok: true, reason: null };

  const stored = await kv.get<LocalMainPullResult>(localMainPullKey(environmentId));
  if (!stored) return { attempted: false, ok: true, reason: null };
  return stored.ok
    ? { attempted: true, ok: true, reason: null }
    : { attempted: true, ok: false, reason: stored.reason };
}

async function currentHeadSha(sdk: Sdk, environmentId: string): Promise<string | null> {
  const status = await sdk.environments.status({ environmentId });
  return status.outcome === "available" ? checkoutHeadSha(status.workspace.checkout) : null;
}

// "unborn" (a repository with no commits) and "unknown" (could not
// determine) carry no SHA at all — they have nothing to compare against a
// stored "already merged".
type WorkspaceCheckout =
  | { kind: "branch"; headSha: string | null }
  | { kind: "detached"; headSha: string | null }
  | { kind: "unborn" }
  | { kind: "unknown" };

function checkoutHeadSha(checkout: WorkspaceCheckout): string | null {
  switch (checkout.kind) {
    case "branch":
    case "detached":
      return checkout.headSha;
    case "unborn":
    case "unknown":
      return null;
  }
}

// A cache of the measured fact, not a memory of our own action. The content
// check (src/wiring/merged-content.ts) costs a `git fetch`, and its answer
// cannot change while HEAD stays put — so a HEAD once found merged is
// remembered, and every later poll answers from KV without touching the
// network. A new commit moves HEAD, the match breaks, and the fact gets
// measured again.
//
// The value is only ever trusted as "already merged"; nothing hides behind
// its absence, so a cache that was never written (a merge through bb's own
// button, through github.com, through `gh`) costs one measurement, not a
// ghost button — see memory/decisions/pr-button-merged-by-content.md.
function mergedHeadKey(environmentId: string): string {
  return `merged-head:${environmentId}`;
}

function localMainPullKey(environmentId: string): string {
  return `local-main-pull:${environmentId}`;
}

async function wasHeadAlreadyMerged(
  kv: PluginKvStorage,
  environmentId: string,
  headSha: string | null,
): Promise<boolean> {
  if (!headSha) return false;
  const mergedSha = await kv.get<string>(mergedHeadKey(environmentId));
  return mergedSha === headSha;
}

async function environmentIdOf(sdk: Sdk, threadId: string): Promise<string | null> {
  const thread = await sdk.threads.get({ threadId });
  return thread.environmentId;
}

// environments.pullRequest throws a 409 for personal/non-git/deleted
// environments — that's not our error, it's "there's nowhere for a PR to
// come from here". We swallow it into "unknown" so prState doesn't fail on
// every such thread.
//
// A live PR (open/draft) blocks the button; a merged/closed one doesn't: a
// new PR can be opened for a new commit on top of a merged one.
async function lookupPullRequest(
  sdk: Sdk,
  environmentId: string,
): Promise<{
  presence: PrPresence;
  url: string | null;
  number: number | null;
  state: PrState | null;
  checksState: ChecksState | null;
}> {
  try {
    const pr = await sdk.environments.pullRequest({ environmentId });
    if (pr.outcome === "available") {
      const { state, url, number, checks } = pr.pullRequest;
      const presence: PrPresence =
        state === "open" || state === "draft" ? "open" : "settled";
      return { presence, url, number, state, checksState: checks.state };
    }
    if (pr.outcome === "absent") {
      return { presence: "absent", url: null, number: null, state: null, checksState: null };
    }
    return { presence: "unknown", url: null, number: null, state: null, checksState: null };
  } catch {
    return { presence: "unknown", url: null, number: null, state: null, checksState: null };
  }
}

type GithubTokenSettings = { get(): Promise<{ githubToken: string | undefined }> };

// The default token comes from gh on the bb machine; we only call gh when
// the setting is empty, to avoid spawning the process needlessly.
async function resolveToken(settings: GithubTokenSettings): Promise<string> {
  const { githubToken } = await settings.get();
  const ghToken = githubToken?.trim() ? null : await ghAuthToken();
  const token = chooseToken(githubToken, ghToken);
  if (!token) {
    throw new Error(
      "No GitHub token: gh is not authorized and no token is set in the settings. " +
        "Run `gh auth login` or set a token in the plugin settings.",
    );
  }
  return token;
}

async function readOrigin(
  sdk: Sdk,
  hostId: string,
  path: string,
): Promise<RepoRef> {
  const configText = await readGitConfig(sdk, hostId, path);
  const originUrl = originUrlFromGitConfig(configText);
  if (!originUrl) throw new Error("git-config has no origin remote.");
  const repo = parseGithubRemote(originUrl);
  if (!repo) throw new Error(`origin is not on github.com: ${originUrl}`);
  return repo;
}

// For a worktree, `<path>/.git` is a pointer file to the shared gitdir; for
// a regular checkout it's a directory, and then config sits right in
// `<path>/.git/config`.
async function readGitConfig(
  sdk: Sdk,
  hostId: string,
  path: string,
): Promise<string> {
  try {
    const pointer = decode(await sdk.files.read({ path: `${path}/.git`, hostId }));
    const gitdir = parseGitdirPointer(pointer);
    if (gitdir) {
      return decode(
        await sdk.files.read({ path: configPathFromGitdir(gitdir), hostId }),
      );
    }
  } catch {
    // `.git` is a directory: fall through to reading config directly below.
  }
  return decode(await sdk.files.read({ path: `${path}/.git/config`, hostId }));
}

async function buildChangedFiles(
  sdk: Sdk,
  hostId: string,
  path: string,
  files: readonly { path: string; status: Parameters<typeof isDeletion>[0] }[],
): Promise<ChangedFile[]> {
  const result: ChangedFile[] = [];
  for (const file of files) {
    if (isDeletion(file.status)) {
      result.push({ kind: "delete", path: file.path });
      continue;
    }
    const read = (await sdk.files.read({
      path: `${path}/${file.path}`,
      hostId,
    })) as FileRead;
    // We hand the content to GitHub as is: utf8 → blob utf-8, base64 → base64.
    result.push({
      kind: "upsert",
      path: file.path,
      content: read.content,
      encoding: read.contentEncoding === "base64" ? "base64" : "utf-8",
    });
  }
  return result;
}

function prBody(commits: readonly { subject: string }[]): string {
  if (commits.length === 0) return "Opened from bb.";
  return commits.map((commit) => `- ${commit.subject}`).join("\n");
}

function decode(file: FileRead): string {
  return file.contentEncoding === "base64"
    ? Buffer.from(file.content, "base64").toString("utf8")
    : file.content;
}
