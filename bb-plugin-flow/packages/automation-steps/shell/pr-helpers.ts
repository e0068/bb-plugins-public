// Помощники шагов набора Pull Request: открыть PR, смёрджить, подтянуть main,
// подтянуть ветку, архивировать тред. Жили в server.ts плагина Automations;
// здесь — чтобы тем же кодом пользовался Flow. Логика перенесена без правок,
// мир приходит аргументами: SDK, kv плагина и настройка токена.
import type { BbPluginApi, PluginKvStorage } from "@get-bb/plugin-sdk";

import { type BaseMode, DEFAULT_BASE_MODE, type ResolvedBase, isBaseMode, resolveBase } from "../core/base-branch";
import type { BumpLevel } from "../core/plugin-version-bump";
import { decodeBase64 } from "../core/base64";
import { isDeletion } from "../core/changed-files";
import { configPathFromGitdir, originUrlFromGitConfig, parseGitdirPointer } from "../core/git-config";
import {
  compareRequest,
  listOpenPullRequestsRequest,
  parseComparison,
  parseOpenPullRequest,
  type ChangedFile,
  type OpenPullRequest,
  type RepoRef,
} from "../core/github-requests";
import { parseMergeBaseRef } from "../core/merge-base";
import { parseMergeability } from "../core/merge-readiness";
import type { ArchiveFailure, MergeFailure } from "../core/notification";
import { type PrSignal, refineWithLiveOpenPr } from "../core/open-pr-refinement";
import { choosePrTitle } from "../core/pr-title";
import { parseGithubRemote } from "../core/remote";
import { chooseToken } from "../core/token";
import type { PrPresence } from "../core/visibility";
import { bbCliClient } from "../wiring/bb-cli-client";
import { type CreatePrPorts, runCreatePr } from "../wiring/create-pr";
import { type CatchUpOutcome, runCatchUp } from "../wiring/catch-up";
import { liveAheadCount } from "../wiring/fast-forward";
import { ghAuthToken } from "../wiring/gh-token";
import { gitClient } from "../wiring/git-client";
import { githubClient } from "../wiring/github-client";
import { readLinkedTask } from "../wiring/linked-task";
import { type LocalMainPullResult, runLocalMainPull } from "../wiring/local-main-pull";
import { checkMergedContent } from "../wiring/merged-content";
import { findLiveOpenPr } from "../wiring/open-pr-lookup";
import { bumpVersionsBeforeMerge, type MergeTimeBumpReport } from "../wiring/merge-time-bump";
import { reinstallTouchedPlugins, type PluginsPort, type ReinstallReport } from "../wiring/plugin-reinstall";
import { applyPluginVersionBumps, githubVersionBumpPorts } from "../wiring/plugin-version-bump";
import { type VisibilityPorts, type VisibilityWorkspace, resolveVisibility } from "../wiring/visibility-decision";

export type Sdk = BbPluginApi["sdk"];

export type FileRead = { content: string; contentEncoding: "base64" | "utf8" };

// The ports for resolveVisibility: KV as the cache of the measured fact, git
// as the measurement itself. The order in which they are consulted lives in
// src/wiring/visibility-decision.ts.
export function visibilityPorts(
  kv: PluginKvStorage,
  environmentId: string,
  path: string | null,
  base: ResolvedBase,
): VisibilityPorts {
  return {
    cachedHeadMatches: (headSha) => wasHeadAlreadyMerged(kv, environmentId, headSha),
    rememberMerged: (headSha) => kv.set(mergedHeadKey(environmentId), headSha),
    // Without a working copy on disk there is nothing to run git in, and the
    // question stays unanswered rather than being guessed at.
    measure: async () => (path ? checkMergedContent(gitClient(path), base) : "unknown"),
  };
}

export function visibilityWorkspace(
  workspace: {
    checkout: WorkspaceCheckout;
    workingTree: { hasUncommittedChanges: boolean };
    mergeBase: { aheadCount: number } | null;
  },
  liveAhead: number | null,
): VisibilityWorkspace {
  return {
    headSha: checkoutHeadSha(workspace.checkout),
    hasUncommittedChanges: workspace.workingTree.hasUncommittedChanges,
    aheadCount: liveAhead ?? workspace.mergeBase?.aheadCount ?? 0,
  };
}

// The same staleness computeFastForwardState already guards against (see
// liveAheadCount's doc comment in src/wiring/fast-forward.ts): bb's cached
// aheadCount can sit stale — even at 0 — well past the point a fresh commit
// or a moved `origin/<base>` actually changed it, which either hides the
// "Pull Request" button after a commit or leaves it up after the content
// already landed in base. Fetch and count live whenever there's a working
// copy to measure in; `null` (no path, or the measurement itself failed)
// falls back to the cache rather than guessing.
export async function liveAheadOf(path: string | null, base: ResolvedBase): Promise<number | null> {
  return path ? liveAheadCount(gitClient(path), base) : null;
}

export async function gatherAndCreate(
  sdk: Sdk,
  kv: PluginKvStorage,
  token: string,
  threadId: string,
): Promise<{ url: string; number: number }> {
  // The whole thread, not just its environment id: its name is one of the
  // sources the PR is named from (see choosePrTitle below).
  const thread = await sdk.threads.get({ threadId });
  const environmentId = thread.environmentId;
  if (!environmentId) throw new Error("The thread has no environment with git.");

  const env = await sdk.environments.get({ environmentId });
  const base = resolveBase(env, await resolveBaseMode(kv, environmentId));
  if (!base) throw new Error("Could not determine the environment's base branch.");

  const status = await sdk.environments.status({
    environmentId,
    mergeBaseBranch: base.statusBase,
  });
  if (status.outcome !== "available") {
    throw new Error(`environment git status unavailable (${status.outcome}).`);
  }

  // The token is already resolved (it's needed for runCreatePr too) —
  // wrapped instead of re-resolving via settings, so refining a `settled`
  // signal here never spawns a second `gh auth token` for the same call.
  const pr = await resolvePrSignal(sdk, () => Promise.resolve(token), environmentId, env, base);
  const { mergeBase } = status.workspace;
  const liveAhead = await liveAheadOf(env.path, base);
  const decision = await resolveVisibility(
    visibilityPorts(kv, environmentId, env.path, base),
    { workspace: visibilityWorkspace(status.workspace, liveAhead), pr: pr.presence },
  );
  if (!decision.visible || !mergeBase) {
    throw new Error(`Can't open a PR right now (${decision.reason}).`);
  }

  const path = env.path;
  if (!path) throw new Error("The environment has no working copy on disk.");
  const headBranch = env.branchName;
  if (!headBranch) throw new Error("The environment has no current branch.");

  // The same status object that lists the changed files also names the
  // commit they were diffed against — that commit becomes the PR commit's
  // parent, so the two can't drift apart.
  const mergeBaseSha = parseMergeBaseRef(mergeBase.baseRef);
  if (!mergeBaseSha) {
    throw new Error(`bb did not resolve the merge-base of ${headBranch} with ${base.statusBase}.`);
  }

  const repo = await readOrigin(sdk, env.hostId, path);
  const changedFiles = await buildChangedFiles(sdk, env.hostId, path, mergeBase.files);
  const github = githubClient(token);
  const files = await applyPluginVersionBumps(
    githubVersionBumpPorts(github.send, repo),
    { mergeBase: mergeBaseSha, baseTip: base.githubBase },
    mergeBase.files.map((file) => file.path),
    changedFiles,
  );
  const title = choosePrTitle({
    task: await readLinkedTask(bbCliClient(), threadId),
    threadName: thread.title ?? thread.titleFallback,
    commitSubjects: mergeBase.commits.map((commit) => commit.subject),
    branch: headBranch,
  });

  return runCreatePr(github, {
    repo,
    baseBranch: base.githubBase,
    mergeBaseSha,
    headBranch,
    files,
    title,
    body: prBody(mergeBase.commits),
  });
}

// The step "catch the branch up with main": the tip of the base comes in by
// fast-forward or, when the branch has commits of its own, by a regular merge
// (wiring/catch-up.ts). Counts are measured live after the fetch, not taken
// from `sdk.environments.status`, whose cache can lag behind fresh commits.
export async function catchUpBranch(sdk: Sdk, kv: PluginKvStorage, threadId: string): Promise<CatchUpOutcome> {
  const environmentId = await environmentIdOf(sdk, threadId);
  if (!environmentId) throw new Error("The thread has no environment with git.");
  const env = await sdk.environments.get({ environmentId });
  const base = resolveBase(env, await resolveBaseMode(kv, environmentId));
  if (!base) throw new Error("Could not determine the environment's base branch.");
  if (!env.path) throw new Error("The environment has no working copy on disk.");
  return runCatchUp(gitClient(env.path), base);
}

// We merge with the same method (squash) the project already uses to land a
// branch onto main — see memory/decisions/fast-forward-ff-only-safe.md. bb
// itself makes the request to GitHub (sdk.environments.mergePullRequest),
// the plugin doesn't need to build it by hand like it does for createPr.
export const MERGE_METHOD = "squash";

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The merge itself, once the version bump above it has already been made. */
export async function attemptMerge(run: () => Promise<void>): Promise<MergeFailure | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return { step: "merge", message: messageOf(error) };
  }
}

/**
 * The archive after a merge. The merge has landed by then, so a refusal is an
 * `ArchiveFailure`, not a rejection that would take the merged PR with it.
 */
export async function attemptArchive(run: () => Promise<unknown>): Promise<ArchiveFailure | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return { step: "archive", message: messageOf(error) };
  }
}

// Resolves everything bumpVersionsBeforeMerge needs from the environment
// and hands off. Every way of not getting there is a `problems` entry, not
// a throw: the merge itself must not be blocked by its own bookkeeping, but
// the user must see that the bookkeeping did not happen. The cheap local
// checks come first so that a thread without a PR never spawns `gh` for a
// token it would not use.
export type GithubPull =
  | {
      ok: true;
      ports: CreatePrPorts;
      repo: RepoRef;
      baseBranch: string;
      headBranch: string;
      number: number;
    }
  | { ok: false; reason: string };

// Everything the merge-time steps need to talk to GitHub about this PR: the
// REST port, the repository, both branches and the PR number. Every way of
// not getting there is a reason, not a throw — the merge itself must not be
// blocked by its own bookkeeping, only told why the bookkeeping did not
// happen. The cheap local checks (base/branch/working copy) come first, before
// any token or network is touched.
//
// The PR number is resolved with a fallback: bb's own cache
// (`sdk.environments.pullRequest`, via lookupPullRequest) lags right after a
// mutation (see republishAfterMutation), and the combined "open + merge"
// flows (createAndMergePr/createMergeArchivePr) open the PR milliseconds
// earlier — so on that path bb still answers "no PR" and the version bump,
// mergeability wait and reinstall were all skipped for a PR that plainly
// exists. When the cache has no number we ask GitHub directly, the same
// unstuck path resolvePrSignal uses (findLiveOpenPr + refineWithLiveOpenPr).
// The round trip is paid only on the merge action, never on the idle poll.
export async function githubPullOf(
  sdk: Sdk,
  settings: GithubTokenSettings,
  environmentId: string,
): Promise<GithubPull> {
  const branches = await githubBranchesOf(sdk, settings, environmentId);
  if (!branches.ok) return branches;
  try {
    const { ports, repo, baseBranch, headBranch } = branches;
    const host = await lookupPullRequest(sdk, environmentId);
    const pr =
      host.number !== null
        ? host
        : refineWithLiveOpenPr(host, await findLiveOpenPr(ports, repo, headBranch, baseBranch));
    if (pr.number === null) return { ok: false, reason: "bb reports no pull request for this branch" };
    return { ok: true, ports, repo, baseBranch, headBranch, number: pr.number };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The repository, both branch names and a GitHub port — everything a step
 * needs that is not the pull request itself. Split out of `githubPullOf`
 * because a step that never uses the PR's number must not fail when bb's own
 * PR cache has nothing to say: right after a merge that cache goes quiet (see
 * memory/decisions/republish-catchup-burst-after-mutation.md), and a step
 * demanding a number there would refuse work it can plainly do.
 */
export type GithubBranches =
  | { ok: true; ports: CreatePrPorts; repo: RepoRef; baseBranch: string; headBranch: string }
  | { ok: false; reason: string };

export async function githubBranchesOf(
  sdk: Sdk,
  settings: GithubTokenSettings,
  environmentId: string,
): Promise<GithubBranches> {
  try {
    const env = await sdk.environments.get({ environmentId });
    // The GitHub API only ever wants the bare branch name (githubBase,
    // mode-independent) — this call never touches statusBase.
    const base = resolveBase(env, DEFAULT_BASE_MODE);
    if (!base) return { ok: false, reason: "could not determine the base branch" };
    if (!env.path) return { ok: false, reason: "the environment has no working copy on disk" };
    if (!env.branchName) return { ok: false, reason: "the environment has no current branch" };
    const token = await resolveToken(settings);
    const repo = await readOrigin(sdk, env.hostId, env.path);
    return { ok: true, ports: githubClient(token), repo, baseBranch: base.githubBase, headBranch: env.branchName };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

// The shared step for git.pull-main (best-effort, after a merge by default)
// and retryMainPull (an explicit retry on click): resolve the environment's
// path/base, try to pull main, and save the result to KV. Returns `null`
// when there's nothing to try (no path or base branch) — the effect
// silently skips the step at that point, retryMainPull turns it into an RPC error.
export async function attemptLocalMainPull(
  sdk: Sdk,
  kv: PluginKvStorage,
  environmentId: string,
): Promise<LocalMainPullResult | null> {
  const env = await sdk.environments.get({ environmentId });
  // This always pulls the remote into the local ref — its own job regardless
  // of the base-mode toggle — so only githubBase (mode-independent) is used.
  const base = resolveBase(env, DEFAULT_BASE_MODE);
  if (!base || !env.path) return null;

  const pull = await runLocalMainPull(gitClient(env.path), base.githubBase);
  await kv.set(localMainPullKey(environmentId), pull);
  return pull;
}

export async function currentHeadSha(sdk: Sdk, environmentId: string): Promise<string | null> {
  const status = await sdk.environments.status({ environmentId });
  return status.outcome === "available" ? checkoutHeadSha(status.workspace.checkout) : null;
}

// "unborn" (a repository with no commits) and "unknown" (could not
// determine) carry no SHA at all — they have nothing to compare against a
// stored "already merged".
export type WorkspaceCheckout =
  | { kind: "branch"; headSha: string | null }
  | { kind: "detached"; headSha: string | null }
  | { kind: "unborn" }
  | { kind: "unknown" };

export function checkoutHeadSha(checkout: WorkspaceCheckout): string | null {
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
export function mergedHeadKey(environmentId: string): string {
  return `merged-head:${environmentId}`;
}

export function localMainPullKey(environmentId: string): string {
  return `local-main-pull:${environmentId}`;
}

export function baseModeKey(environmentId: string): string {
  return `base-mode:${environmentId}`;
}

/** The one shared base-mode choice for an environment; unset or malformed KV both mean the default. */
export async function resolveBaseMode(kv: PluginKvStorage, environmentId: string): Promise<BaseMode> {
  const stored = await kv.get<BaseMode>(baseModeKey(environmentId));
  return isBaseMode(stored) ? stored : DEFAULT_BASE_MODE;
}

export async function wasHeadAlreadyMerged(
  kv: PluginKvStorage,
  environmentId: string,
  headSha: string | null,
): Promise<boolean> {
  if (!headSha) return false;
  const mergedSha = await kv.get<string>(mergedHeadKey(environmentId));
  return mergedSha === headSha;
}

export async function environmentIdOf(sdk: Sdk, threadId: string): Promise<string | null> {
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
export async function lookupPullRequest(sdk: Sdk, environmentId: string): Promise<PrSignal> {
  try {
    const pr = await sdk.environments.pullRequest({ environmentId });
    if (pr.outcome === "available") {
      const { state, url, number, checks, mergeability } = pr.pullRequest;
      const presence: PrPresence =
        state === "open" || state === "draft" ? "open" : "settled";
      return {
        presence,
        url,
        number,
        state,
        checksState: checks.state,
        mergeability: parseMergeability(mergeability.mergeable),
      };
    }
    if (pr.outcome === "absent") {
      return {
        presence: "absent",
        url: null,
        number: null,
        state: null,
        checksState: null,
        mergeability: null,
      };
    }
    return {
      presence: "unknown",
      url: null,
      number: null,
      state: null,
      checksState: null,
      mergeability: null,
    };
  } catch {
    return {
      presence: "unknown",
      url: null,
      number: null,
      state: null,
      checksState: null,
      mergeability: null,
    };
  }
}

// Best-effort direct GitHub measurement for "is there a live open PR on this
// branch" — bypasses the host's own signal entirely. Used by resolvePrSignal
// to refine a stale host verdict, and by computeRowFacts alongside it.
// Degrades to `null` on any missing piece (no base, no working copy, no
// branch name) or any failure (no token, origin unreadable, GitHub
// unreachable) — never throws, same spirit as lookupPullRequest.
export async function findLiveOpenPrForEnv(
  sdk: Sdk,
  getToken: () => Promise<string>,
  env: { hostId: string; path: string | null; branchName: string | null },
  base: ResolvedBase | null,
): Promise<OpenPullRequest | null> {
  if (!base || !env.path || !env.branchName) return null;
  try {
    const repo = await readOrigin(sdk, env.hostId, env.path);
    const token = await getToken();
    return await findLiveOpenPr(githubClient(token), repo, env.branchName, base.githubBase);
  } catch {
    return null;
  }
}

// The single point where a stale host `pr` signal is upgraded to `open` when
// GitHub itself already has a live PR for the branch that the host stopped
// tracking (see memory/decisions/open-pr-bypass-host-terminal-signal.md).
// Every call site that used to read `lookupPullRequest` directly reads this
// instead, so the header buttons, the archive gate, the create-PR guard and
// the sidebar row-status glyph all agree on the same, unstuck signal.
//
// Only `settled` is the one gap worth double-checking — a host verdict of
// merged/closed for a branch that has since grown a fresh open PR (the
// normal flow once a settled PR lets the "Pull Request" button reappear).
// `absent` and `unknown` are trusted as-is too: paying for a GitHub round
// trip there wouldn't fix anything a `settled`→`open` upgrade doesn't
// already cover, and `open` is already live and correct. Either way the
// network is only ever touched for the one case it can actually fix.
export async function resolvePrSignal(
  sdk: Sdk,
  getToken: () => Promise<string>,
  environmentId: string,
  env: { hostId: string; path: string | null; branchName: string | null },
  base: ResolvedBase | null,
): Promise<PrSignal> {
  const host = await lookupPullRequest(sdk, environmentId);
  if (host.presence !== "settled") return host;
  const found = await findLiveOpenPrForEnv(sdk, getToken, env, base);
  return refineWithLiveOpenPr(host, found);
}

export type GithubTokenSettings = { get(): Promise<{ githubToken: string | undefined }> };

// The default token comes from gh on the bb machine; we only call gh when
// the setting is empty, to avoid spawning the process needlessly.
export async function resolveToken(settings: GithubTokenSettings): Promise<string> {
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

export async function readOrigin(
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
export async function readGitConfig(
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

export async function buildChangedFiles(
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

export function prBody(commits: readonly { subject: string }[]): string {
  if (commits.length === 0) return "Opened from bb.";
  return commits.map((commit) => `- ${commit.subject}`).join("\n");
}

export function decode(file: FileRead): string {
  return file.contentEncoding === "base64" ? decodeBase64(file.content) : file.content;
}

/**
 * The step "raise the version": settles every plugin the PR touches on a
 * version the chosen level puts strictly above the base, and commits it onto
 * the PR's branch before the merge (wiring/merge-time-bump.ts).
 *
 * The PR arrives already resolved (githubPullOf) instead of being looked up
 * here: that keeps the GitHub port injectable, so this is tested with a fake
 * `send` and never touches the network in tests.
 *
 * Nothing here throws and nothing here blocks a merge on its own bookkeeping:
 * a PR that could not be resolved comes back as `unavailable` AND as a
 * `problems` line, so a caller that only reads `problems` (Automations, where
 * the bump is best-effort) and one that fails its step on `unavailable`
 * (Flow, where the chain must stop) both see the same fact.
 */
export async function settleVersionsForMerge(
  gh: GithubPull,
  level: BumpLevel,
): Promise<MergeTimeBumpReport & { unavailable: string | null }> {
  const skipped = (reason: string): MergeTimeBumpReport & { unavailable: string | null } => ({
    changedPaths: [],
    bumped: [],
    problems: [`versions not settled: ${reason}`],
    headMoved: false,
    unavailable: reason,
  });
  if (!gh.ok) return skipped(gh.reason);
  try {
    const report = await bumpVersionsBeforeMerge(gh.ports, {
      repo: gh.repo,
      baseBranch: gh.baseBranch,
      headBranch: gh.headBranch,
      pullNumber: gh.number,
      level,
    });
    return { ...report, unavailable: null };
  } catch (error) {
    return skipped(messageOf(error));
  }
}

/**
 * The step "bring the plugins onto the merged code": every plugin the PR
 * itself changed is updated in place, installed afresh, or — when bb holds it
 * from another source — handed back as a repoint for a human, because the
 * remove that a repoint needs would take the plugin's settings, secrets and
 * schedules with it (wiring/plugin-reinstall.ts).
 *
 * Which files the PR changed is asked of GitHub by comparing the base with
 * the head, not of the local main: the local branch advances by whatever else
 * landed meanwhile, and that range names plugins this merge never touched
 * (memory/decisions/reinstall-from-merged-pr-files.md). The comparison still
 * answers after the merge because bb leaves the head branch on origin.
 *
 * The plugin running the chain is never updated here: bb drops its API handle
 * as it updates, which would cut the chain mid-run. It comes back as
 * `pendingSelfUpdate` for the caller to apply once everything else is done.
 */
export async function reinstallAfterMerge(
  gh: GithubBranches,
  plugins: PluginsPort,
  ownPluginId: string,
): Promise<ReinstallReport & { unavailable: string | null }> {
  const nothing = (unavailable: string | null): ReinstallReport & { unavailable: string | null } => ({
    reinstalled: [],
    installed: [],
    repoints: [],
    problems: [],
    pendingSelfUpdate: null,
    unavailable,
  });
  if (!gh.ok) return nothing(gh.reason);
  try {
    // Обновление тянет плагин с базовой ветки, поэтому до мёрджа оно
    // поставило бы код БЕЗ этой ветки и отрапортовало бы «обновлено». Влит
    // ли PR, спрашивается у самого GitHub, а не у кэша bb: сразу после
    // мёрджа тот ещё показывает PR открытым (memory/decisions/
    // republish-catchup-burst-after-mutation.md), и шаг, поверивший ему,
    // падал бы ровно на штатной цепочке «смёрджить → обновить». Ответ не
    // 200 — это «не смогли спросить», а не «влит»: иначе отвалившийся токен
    // сам себя прочитал бы как разрешение ставить плагины с базовой ветки.
    const open = await gh.ports.send(listOpenPullRequestsRequest(gh.repo, gh.headBranch, gh.baseBranch));
    if (open.status !== 200) {
      return nothing(`could not check whether the pull request is merged (HTTP ${open.status})`);
    }
    if (parseOpenPullRequest(open.data) !== null) return nothing("the pull request is not merged yet");

    const compared = await gh.ports.send(compareRequest(gh.repo, gh.baseBranch, gh.headBranch));
    const comparison = compared.status === 200 ? parseComparison(compared.data) : null;
    if (!comparison) {
      return nothing(`could not read the files of the pull request (HTTP ${compared.status})`);
    }
    const report = await reinstallTouchedPlugins(plugins, comparison.changedPaths, {
      repo: gh.repo,
      baseBranch: gh.baseBranch,
      ownPluginId,
    });
    return { ...report, unavailable: null };
  } catch (error) {
    return nothing(messageOf(error));
  }
}
