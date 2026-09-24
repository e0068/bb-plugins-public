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
  getPullRequestRequest,
  listOpenPullRequestsRequest,
  parseComparison,
  parseOpenPullRequest,
  parsePullState,
  type ChangedFile,
  type OpenPullRequest,
  type PullState,
  type RepoRef,
} from "../core/github-requests";
import { parseMergeBaseRef } from "../core/merge-base";
import { parseMergeability } from "../core/merge-readiness";
import type { BumpGap, StepOutcome } from "../core/step-outcomes";
import type { ArchiveFailure, MergeFailure } from "../core/notification";
import { alreadyOpenPr, type PrSignal, refineWithLiveOpenPr } from "../core/open-pr-refinement";
import { afterAnswer, decideLiveAsk, type AwaitMark } from "../core/pr-await";
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
import { waitForMergeability } from "../wiring/mergeability-wait";
import { askLiveOpenPr, findLiveOpenPr, type OpenPrAnswer } from "../wiring/open-pr-lookup";
import { readMark, writeMark } from "../wiring/pr-await-store";
import { bumpVersionsBeforeMerge, type MergeTimeBumpReport } from "../wiring/merge-time-bump";
import { reinstallTouchedPlugins, type PluginsPort, type ReinstallReport } from "../wiring/plugin-reinstall";
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
): Promise<{ url: string; number: number; existed: boolean }> {
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
  // Повтор шага не открывает второй PR и не объявляет отказ по уже сделанной
  // работе: открытый PR ветки — это его собственный итог. Вопрос идёт к самому
  // GitHub, а не к кэшу bb: кэш и отстаёт сразу после создания, и держит
  // открытым PR, которого уже нет, — по такому шаг отчитался бы чужим адресом.
  const open = alreadyOpenPr(pr, await askLiveOpenPrForEnv(sdk, () => Promise.resolve(token), env, base));
  if (open !== null) {
    // bb ещё держит прошлый PR — значку нужно время, чтобы увидеть этот.
    if (pr.presence !== "open") await markAwaiting(sdk, environmentId, "publish");
    return { ...open, existed: true };
  }
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
  // Версию здесь не поднимают: это делает шаг бампа, стоящий сразу за созданием
  // PR (wiring/merge-time-bump.ts). Он вливает базу в ветку и считает от того,
  // что в базе сейчас, поэтому обходится без защиты от расхождения с ней.
  const files = await buildChangedFiles(sdk, env.hostId, path, mergeBase.files);
  const github = githubClient(token);
  const title = choosePrTitle({
    task: await readLinkedTask(bbCliClient(), threadId),
    threadName: thread.title ?? thread.titleFallback,
    commitSubjects: mergeBase.commits.map((commit) => commit.subject),
    branch: headBranch,
  });

  await markAwaiting(sdk, environmentId, "publish");
  const created = await runCreatePr(github, {
    repo,
    baseBranch: base.githubBase,
    mergeBaseSha,
    headBranch,
    files,
    title,
    body: prBody(mergeBase.commits),
  });
  return { ...created, existed: false };
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

// A merge commit, not a squash. A squash put a single-parent commit on main,
// so local main diverged from the branch it came from and the next piece of
// work in the same checkout started by reconciling them. A merge commit keeps
// the branch's commit as a parent and lets local main fast-forward to origin.
// What it does NOT do: the PR's head is one synthetic commit built through the
// API without a push (see wiring/create-pr.ts), so the branch's own commits
// still never reach main — only that single commit does, as the second parent.
// bb itself makes the request to GitHub (sdk.environments.mergePullRequest),
// the plugin doesn't need to build it by hand like it does for createPr.
export const MERGE_METHOD = "merge";

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The merge step's whole answer: what GitHub says about the PR, the merge
 * itself, and what to tell the owner when it did not happen.
 *
 * Three things are asked before the merge is fired. A PR already merged —
 * a repeat of the step, or a merge made by hand — is the step's own goal
 * reached, so it answers success instead of the host's "not currently
 * mergeable". A PR closed without a merge is a refusal no retry can fix, and
 * it is named as such. A branch GitHub calls conflicting is named too,
 * because "HTTP 409" tells the owner nothing about which of the two it is.
 *
 * What is NOT handled here is the window in which GitHub recomputes
 * mergeability after the head moved: the merge is simply fired, and its 409
 * comes back as a transient failure that steps.ts repeats. The repeat runs
 * this whole helper again, so a PR that landed meanwhile answers success and
 * a branch that turned out to conflict answers with its named reason.
 */
export async function mergeWithVerdict(gh: GithubPull, merge: () => Promise<void>): Promise<StepOutcome> {
  // Не смогли спросить GitHub — мёрдж всё равно пробуется: его делает сам bb,
  // и наша неудача с токеном или сетью не повод не сделать работу. Ответит
  // тогда bb, своей ошибкой.
  if (!gh.ok) return reportMerge(await attemptMerge(merge));

  const before = await readPullState(gh);
  if (before === "merged") return { ok: true, detail: "already merged" };
  if (before === "closed") {
    return { ok: false, error: "the pull request is closed without a merge — reopen it or open a new one" };
  }
  if ((await waitForMergeability(gh.ports, gh.repo, gh.number)) === "conflicting") {
    return { ok: false, error: `the branch conflicts with ${gh.baseBranch} — catch the branch up with the base, resolve the conflicts and run the step again` };
  }

  const failure = await attemptMerge(merge);
  if (failure === null) return { ok: true, detail: null };
  // Мёрдж мог и пройти: bb отвечает ошибкой и на потерянный ответ тоже.
  // Спрашиваем GitHub, а не гадаем по тексту.
  return (await readPullState(gh)) === "merged" ? { ok: true, detail: "already merged" } : reportMerge(failure);
}

const reportMerge = (failure: MergeFailure | null): StepOutcome =>
  failure === null ? { ok: true, detail: null } : { ok: false, error: failure.message };

/** Состояние PR у самого GitHub; не 200 — это «не смогли спросить», а не состояние. */
async function readPullState(gh: GithubPull & { ok: true }): Promise<PullState> {
  const answer = await gh.ports.send(getPullRequestRequest(gh.repo, gh.number));
  return answer.status === 200 ? parsePullState(answer.data) : "unknown";
}

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
  | { ok: false; reason: string; gap?: BumpGap | null };

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
    // PR нет ни у bb, ни у самого GitHub — значит, шаг стоит в цепочке до его
    // открытия. Это пробел, а не поломка: версия поднимется тем же шагом перед
    // мёрджем, и цепочку останавливать незачем.
    if (pr.number === null) return { ok: false, reason: "bb reports no pull request for this branch", gap: "no-pull-request" };
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
 * docs/decisions/republish-catchup-burst-after-mutation.md), and a step
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
// ghost button — see docs/decisions/pr-button-merged-by-content.md.
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
// for a thread that is waiting (core/pr-await.ts), and by gatherAndCreate as
// its guard against a second PR. Degrades to `{ asked: false }` on any missing
// piece (no base, no working copy, no branch name) or any failure (no token,
// origin unreadable, GitHub unreachable or rate-limited) — never throws, same
// spirit as lookupPullRequest.
export async function askLiveOpenPrForEnv(
  sdk: Sdk,
  getToken: () => Promise<string>,
  env: { hostId: string; path: string | null; branchName: string | null },
  base: ResolvedBase | null,
): Promise<OpenPrAnswer> {
  if (!base || !env.path || !env.branchName) return { asked: false };
  try {
    const repo = await readOrigin(sdk, env.hostId, env.path);
    const token = await getToken();
    return await askLiveOpenPr(githubClient(token), repo, env.branchName, base.githubBase);
  } catch {
    return { asked: false };
  }
}

/** Мир уточнения сигнала: сигнал bb, отметка «ждёт» ветки, живой вопрос GitHub и часы. `key` склеивает одновременные опросы одного окружения. */
export interface PrSignalPorts {
  key: string;
  host(): Promise<PrSignal>;
  readMark(): Promise<AwaitMark | null>;
  writeMark(mark: AwaitMark | null): Promise<void>;
  askLive(): Promise<OpenPrAnswer>;
  now(): number;
}

const inFlight = new Map<string, Promise<PrSignal>>();

// Опрос значков спрашивает каждую строку в каждом окне разом; вопросы по
// одному окружению, пришедшие, пока первый ещё идёт, получают его ответ, а не
// свой поход в GitHub.
export function refinePrSignal(ports: PrSignalPorts): Promise<PrSignal> {
  const running = inFlight.get(ports.key);
  if (running) return running;
  const next = refineOnce(ports).finally(() => inFlight.delete(ports.key));
  inFlight.set(ports.key, next);
  return next;
}

async function refineOnce(ports: PrSignalPorts): Promise<PrSignal> {
  const host = await ports.host();
  const mark = await ports.readMark();
  if (mark === null) return host;
  const now = ports.now();
  const decision = decideLiveAsk(mark, host.presence, now);
  switch (decision) {
    case "host":
      return host;
    case "reuse":
      return refineWithLiveOpenPr(host, mark.found);
    case "drop":
      await writeUnlessReplaced(ports, mark, null);
      return host;
    case "ask": {
      const next = afterAnswer(mark, await ports.askLive(), now);
      await writeUnlessReplaced(ports, mark, next);
      return refineWithLiveOpenPr(host, next?.found ?? null);
    }
    default:
      return absurd(decision);
  }
}

// Пока шёл вопрос к GitHub, нажатие могло поставить свежую отметку; ответ на
// старую её не затирает.
async function writeUnlessReplaced(ports: PrSignalPorts, read: AwaitMark, next: AwaitMark | null): Promise<void> {
  if ((await ports.readMark())?.since !== read.since) return;
  await ports.writeMark(next);
}

const absurd = (value: never): never => {
  throw new Error(`unreachable: ${String(value)}`);
};

// The single point where the host's PR signal is refined with a live GitHub
// answer (see docs/decisions/open-pr-bypass-host-terminal-signal.md). Every
// call site reads this, so the header buttons, the archive gate, the
// create-PR guard and the sidebar row-status glyph all agree on one signal.
//
// GitHub is asked only for a thread that is waiting — the owner pressed
// "publish PR" and bb doesn't see it yet, or a merge was attempted and the PR
// is still open — and at most once a minute (core/pr-await.ts). Asking on
// every `settled` verdict of every sidebar poll burned the 5000-per-hour REST
// quota. A thread without the mark gets bb's own signal, with no network.
export async function resolvePrSignal(
  sdk: Sdk,
  getToken: () => Promise<string>,
  environmentId: string,
  env: { hostId: string; path: string | null; branchName: string | null },
  base: ResolvedBase | null,
): Promise<PrSignal> {
  const host = () => lookupPullRequest(sdk, environmentId);
  if (!env.path || !env.branchName) return host();
  const git = gitClient(env.path);
  const branch = env.branchName;
  return refinePrSignal({
    key: environmentId,
    host,
    readMark: () => readMark(git, branch),
    // Несохранённая отметка стоит лишнего вопроса через минуту, а не сломанного значка.
    writeMark: (mark) => writeMark(git, branch, mark).catch(() => undefined),
    askLive: () => askLiveOpenPrForEnv(sdk, getToken, env, base),
    now: Date.now,
  });
}

// Ставит отметку «ждёт» перед действием, после которого bb какое-то время
// не видит правды о PR: публикацией и мёрджем. Отметка помогает значку, но
// не держит действие: сбой записи проглатывается.
export async function markAwaiting(sdk: Sdk, environmentId: string, kind: AwaitMark["kind"]): Promise<void> {
  try {
    const env = await sdk.environments.get({ environmentId });
    if (!env.path || !env.branchName) return;
    await writeMark(gitClient(env.path), env.branchName, { kind, since: Date.now(), askedAt: null, found: null });
  } catch {
    // Без отметки значок покажет сигнал bb — это прежнее поведение, не поломка.
  }
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
  const skipped = (reason: string, gap: BumpGap | null = null): MergeTimeBumpReport & { unavailable: string | null } => ({
    changedPaths: [],
    bumped: [],
    problems: [`versions not settled: ${reason}`],
    headMoved: false,
    gap,
    unavailable: reason,
  });
  if (!gh.ok) return skipped(gh.reason, gh.gap ?? null);
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
 * (docs/decisions/reinstall-from-merged-pr-files.md). The comparison still
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
    // мёрджа тот ещё показывает PR открытым (docs/decisions/
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
