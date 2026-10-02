// Layer 3 (shell), the testable part — makes sure every plugin a PR touches
// ends up with a version strictly above what the base branch has. Verified
// with a fake `send`, no network; the real `send` is github-client.ts.
//
// This is the only place a version is raised. A chain runs it right after
// opening the PR, and a chain that also merges runs it again right before
// the merge — the version decided at opening can be taken by a neighbouring
// PR while the checks run. Running it twice costs nothing: the plan is made
// first (core/merge-time-bump.ts), and a branch already standing above the
// base answers `ahead`, so the head is not rewritten at all. See
// docs/decisions/version-bump-decided-at-merge.md.
//
// Why the branch is caught up with the base first: the PR's commit is
// parented on its merge-base, so a version set on the branch is three-way
// merged against the base's own edit of the same line — two different values
// from one common ancestor is a conflict, whatever we choose. Once the base
// has been merged INTO the branch (GitHub's own "Update branch"), the base
// is an ancestor of the head, the merge is a fast-forward of our commit, and
// the only side changing the version line is ours. A conflict in that update
// is a real conflict the author has to resolve; it stops the bump and is
// reported, never papered over.
//
// Everything here is best-effort with respect to the merge itself: a
// problem is returned, not thrown, and the caller merges anyway — a merge
// with a stale version is what we had before, a merge blocked by its own
// bookkeeping would be worse. What's not allowed is silence: every skip has
// a reason that reaches the user.
//
// The same commit stamps the plugin's changelog: every entry file the PR
// carries gets the version the plugin lands on, and a PR that wrote none gets
// one made of its title (core/changelog-entry.ts). Only when the caller names
// the date to stamp — without it the changelog is left alone.
import { decodeBase64 } from "../core/base64";
import {
  buildTreeEntries,
  commitRequest,
  compareRequest,
  contentsRequest,
  getBranchRequest,
  getCommitRequest,
  getPullRequestRequest,
  parseComparison,
  parseFileContent,
  treeRequest,
  updateBranchRequest,
  updateRefRequest,
  type ChangedFile,
  type RepoRef,
} from "../core/github-requests";
import { belongsToPull, changelogEntriesOf, fallbackEntry, fallbackEntryPath, isChangelogPath, keepsChangelog, stampEntry, type EntryStamp } from "../core/changelog-entry";
import { planMergeTimeBump } from "../core/merge-time-bump";
import type { BumpGap } from "../core/step-outcomes";
import {
  affectedPluginRoots,
  bumpPackageLockVersion,
  setPackageJsonVersion,
  topLevelVersion,
  type BumpLevel,
} from "../core/plugin-version-bump";
import { createBlobs, pickString, requireStatus, type CreatePrPorts } from "./create-pr";

export interface MergeTimeBumpInput {
  repo: RepoRef;
  baseBranch: string;
  headBranch: string;
  pullNumber: number;
  /**
   * Which component to raise — the step the chain carries names it
   * (files.bump-major/minor/patch). "patch" is what every chain did before
   * the levels existed, so it stays the caller's default.
   */
  level: BumpLevel;
  /**
   * The merge moment, UTC to the minute (YYYY-MM-DDTHH:MMZ), the plugins' changelog entries are stamped with; older entries carry a day (YYYY-MM-DD).
   * Absent — the changelog is not touched at all, only the versions.
   */
  changelogDate?: string;
}

export interface MergeTimeBumpReport {
  /** Every path the PR changes, as GitHub lists them — what the post-merge reinstall reads to know which plugins the merge touched. */
  changedPaths: readonly string[];
  bumped: readonly { root: string; to: string }[];
  /** Human-readable reasons something that should have been bumped was not. Empty means every touched plugin is ahead. */
  problems: readonly string[];
  /** Ветки нет на origin — поднимать версию пока не на чем; поля нет — пробела нет. */
  gap?: BumpGap | null;
  /**
   * The PR's head branch was rewritten (caught up with the base and/or given
   * a bump commit). GitHub recomputes the PR's mergeability after that, and
   * a merge fired in the same instant fails — the caller pauses first, the
   * same way it does after opening a PR.
   */
  headMoved: boolean;
}

const UPDATE_BRANCH_ACCEPTED = 202;

export async function bumpVersionsBeforeMerge(
  ports: CreatePrPorts,
  input: MergeTimeBumpInput,
): Promise<MergeTimeBumpReport> {
  const { repo, baseBranch, headBranch } = input;

  const compared = await ports.send(compareRequest(repo, baseBranch, headBranch));
  const comparison = compared.status === 200 ? parseComparison(compared.data) : null;
  if (!comparison) {
    return {
      changedPaths: [],
      bumped: [],
      problems: [`could not compare ${headBranch} with ${baseBranch} (HTTP ${compared.status})`],
      headMoved: false,
      // Сравнения нет, потому что ветки ещё (или уже) нет на origin: PR по ней
      // не открывали или его ветку удалили после мёрджа. Версия поднимется
      // вторым вызовом шага, перед мёрджем.
      gap: compared.status === 404 ? "branch-not-published" : null,
    };
  }

  const { changedPaths } = comparison;
  // The changelog is bookkeeping about a change, not a change: a PR that only
  // edits changelog/ grows no version. Its entries are still found in the full
  // list — the roots decide what is bumped, not which entries are stamped.
  const roots = affectedPluginRoots(changedPaths.filter((path) => !isChangelogPath(path)));
  if (roots.length === 0) return { changedPaths, bumped: [], problems: [], headMoved: false };

  // Decide first; rewrite the head only if there is a bump to commit.
  // Catching up with the base rewrites the PR's head and sends GitHub off to
  // recompute its mergeability — with nothing to bump (the version already
  // grew on an earlier press) that rewrite bought nothing and turned every
  // retry of the Merge button into another wait, and another 409.
  const changelog = input.changelogDate === undefined ? null : changelogOf(ports, input, input.changelogDate, changedPaths);
  const plan = () => planBumps(ports, { repo, roots, headBranch, baseBranch, level: input.level, changelog });
  const planned = await plan();
  if (planned.files.length === 0) {
    return { changedPaths, bumped: [], problems: planned.problems, headMoved: false };
  }

  const caughtUp = comparison.behindBy > 0;
  if (caughtUp) {
    const problem = await catchUpWithBase(ports, input);
    if (problem) return { changedPaths, bumped: [], problems: [problem], headMoved: false };
  }
  // The catch-up merged the base's package.json into the head's: plan again
  // from that content, so the bump lands on it and not on the copy from before.
  const { files, bumped, problems } = caughtUp ? await plan() : planned;
  if (files.length > 0) await commitOntoHead(ports, repo, headBranch, files, commitMessage(bumped, files));
  return { changedPaths, bumped, problems, headMoved: caughtUp || files.length > 0 };
}

interface BumpPlanInput {
  repo: RepoRef;
  roots: readonly string[];
  headBranch: string;
  baseBranch: string;
  level: BumpLevel;
  changelog: ChangelogStamp | null;
}

/** What the changelog part of the plan needs: the day to stamp, the PR, its paths, and — only for a PR without an entry — its title. */
interface ChangelogStamp {
  date: string;
  pull: number;
  changedPaths: readonly string[];
  /** The PR's title, read once however many plugins need it; null when GitHub would not tell. */
  title(): Promise<string | null>;
}

interface RootPlan {
  files: ChangedFile[];
  bumped: { root: string; to: string }[];
  problems: string[];
}

const NOTHING: RootPlan = { files: [], bumped: [], problems: [] };

const joinPlans = (plans: readonly RootPlan[]): RootPlan => ({
  files: plans.flatMap((plan) => plan.files),
  bumped: plans.flatMap((plan) => plan.bumped),
  problems: plans.flatMap((plan) => plan.problems),
});

function changelogOf(ports: CreatePrPorts, input: MergeTimeBumpInput, date: string, changedPaths: readonly string[]): ChangelogStamp {
  let title: Promise<string | null> | null = null;
  return {
    date,
    pull: input.pullNumber,
    changedPaths,
    title: () => (title ??= readPullTitle(ports, input.repo, input.pullNumber)),
  };
}

/** Which files the bump would write, per plugin root, read at the head as it is right now: package.json, package-lock.json and the changelog entries. */
async function planBumps(ports: CreatePrPorts, input: BumpPlanInput): Promise<RootPlan> {
  const plans: RootPlan[] = [];
  for (const root of input.roots) {
    const { version, ...plan } = await planVersion(ports, input, root);
    const entries =
      input.changelog && version !== null && keepsChangelog(root)
        ? await planEntries(ports, input.repo, input.headBranch, root, version, input.changelog)
        : NOTHING;
    plans.push(plan, entries);
  }
  return joinPlans(plans);
}

/** package.json/package-lock.json of one root, and the version the root lands on — null when it has none anybody can name. */
async function planVersion(ports: CreatePrPorts, input: BumpPlanInput, root: string): Promise<RootPlan & { version: string | null }> {
  const { repo, headBranch, baseBranch, level } = input;
  const headJson = await readText(ports, repo, `${root}/package.json`, headBranch);
  const baseJson = await readText(ports, repo, `${root}/package.json`, baseBranch);
  // A root with no package.json on either side (a shared config layer) has
  // no version to grow — that's not a problem, it's not a plugin.
  if (headJson === null && baseJson === null) return { ...NOTHING, version: null };

  const plan = planMergeTimeBump(headJson, baseJson, level);
  if (plan.kind === "ahead") return { ...NOTHING, version: topLevelVersion(headJson ?? "") };
  if (plan.kind === "unknown") return { ...NOTHING, problems: [`${root}: ${plan.reason}`], version: null };

  // `plan.kind === "bump"` implies the head's package.json was readable.
  const set = setPackageJsonVersion(headJson as string, plan.to);
  if (!set) return { ...NOTHING, problems: [`${root}: package.json could not be set to ${plan.to}`], version: null };
  const files: ChangedFile[] = [{ kind: "upsert", path: `${root}/package.json`, content: set.content, encoding: "utf-8" }];
  const problems: string[] = [];

  const lockJson = await readText(ports, repo, `${root}/package-lock.json`, headBranch);
  if (lockJson !== null) {
    const lockNext = bumpPackageLockVersion(lockJson, plan.to);
    if (lockNext) {
      files.push({ kind: "upsert", path: `${root}/package-lock.json`, content: lockNext, encoding: "utf-8" });
    } else {
      problems.push(`${root}: package-lock.json could not be set to ${plan.to}`);
    }
  }
  return { files, bumped: [{ root, to: plan.to }], problems, version: plan.to };
}

/**
 * The root's changelog entries stamped with `version`: the entry files this
 * PR owns (belongsToPull), or — when it carries none still present at the
 * head — one made of the PR's title. Other entries the PR touches, history
 * above all, keep their versions. Unchanged entries are not rewritten, so a
 * second run over the same state commits nothing.
 */
async function planEntries(
  ports: CreatePrPorts,
  repo: RepoRef,
  headBranch: string,
  root: string,
  version: string,
  changelog: ChangelogStamp,
): Promise<RootPlan> {
  const stamp: EntryStamp = { version, date: changelog.date, pull: changelog.pull };
  const read = await Promise.all(
    changelogEntriesOf(root, changelog.changedPaths).map(async (path) => ({ path, text: await readText(ports, repo, path, headBranch) })),
  );
  // An entry the PR deleted is absent at the head: it is not stamped back.
  const present = read.flatMap(({ path, text }) => (text === null ? [] : [{ path, text }]));
  const broken: RootPlan = {
    ...NOTHING,
    problems: present.filter(({ text }) => stampEntry(text, stamp) === null).map(({ path }) => `${path}: not a changelog entry — no header between --- lines`),
  };
  const own = present.filter(({ text }) => belongsToPull(text, changelog.pull));
  if (own.length === 0) return joinPlans([broken, await fallbackPlan(root, stamp, changelog)]);

  // The fallback an earlier run wrote stands in for an entry the PR did not
  // have then; once it has one of its own, the stand-in goes.
  const fallbackPath = fallbackEntryPath(root, changelog.pull);
  const written = own.filter(({ path }) => path !== fallbackPath);
  const staleFallback: RootPlan =
    written.length > 0 && written.length < own.length ? { ...NOTHING, files: [{ kind: "delete", path: fallbackPath }] } : NOTHING;

  return joinPlans([
    broken,
    staleFallback,
    ...(written.length > 0 ? written : own).map(({ path, text }): RootPlan => {
      const stamped = stampEntry(text, stamp) as string;
      return stamped === text ? NOTHING : { ...NOTHING, files: [{ kind: "upsert", path, content: stamped, encoding: "utf-8" }] };
    }),
  ]);
}

async function fallbackPlan(root: string, stamp: EntryStamp, changelog: ChangelogStamp): Promise<RootPlan> {
  const title = await changelog.title();
  const entry = title === null ? null : fallbackEntry(title, stamp);
  if (entry === null) {
    return { ...NOTHING, problems: [`${root}: no changelog entry — the PR carries none and its title ${title === null ? "could not be read" : "is blank"}`] };
  }
  return { ...NOTHING, files: [{ kind: "upsert", path: fallbackEntryPath(root, stamp.pull), content: entry, encoding: "utf-8" }] };
}

/** The PR's title; null when GitHub would not tell — refused, unreachable or malformed: the caller names that as a problem. */
async function readPullTitle(ports: CreatePrPorts, repo: RepoRef, pullNumber: number): Promise<string | null> {
  try {
    const res = await ports.send(getPullRequestRequest(repo, pullNumber));
    const title = res.status === 200 && res.data && typeof res.data === "object" ? (res.data as { title?: unknown }).title : null;
    return typeof title === "string" ? title : null;
  } catch {
    return null;
  }
}

/** Merges the base into the PR branch via GitHub; returns the problem, or null when it went through. */
async function catchUpWithBase(ports: CreatePrPorts, input: MergeTimeBumpInput): Promise<string | null> {
  const { repo, baseBranch, headBranch, pullNumber } = input;
  const head = await ports.send(getBranchRequest(repo, headBranch));
  if (head.status !== 200) {
    return `could not read the tip of ${headBranch} before bumping versions (HTTP ${head.status})`;
  }
  const headSha = pickString(head.data, ["commit", "sha"]);

  const updated = await ports.send(updateBranchRequest(repo, pullNumber, headSha));
  if (updated.status !== UPDATE_BRANCH_ACCEPTED) {
    return `could not catch ${headBranch} up with ${baseBranch} before bumping versions (HTTP ${updated.status}: ${messageOf(updated.data)})`;
  }
  return null;
}

/** blobs → tree on the head's tree → commit parented on the head → ref moved to it. */
async function commitOntoHead(
  ports: CreatePrPorts,
  repo: RepoRef,
  headBranch: string,
  files: readonly ChangedFile[],
  message: string,
): Promise<void> {
  const head = await ports.send(getBranchRequest(repo, headBranch));
  requireStatus(head, 200, `reading the tip of ${headBranch}`);
  const headSha = pickString(head.data, ["commit", "sha"]);

  const headCommit = await ports.send(getCommitRequest(repo, headSha));
  requireStatus(headCommit, 200, `reading commit ${headSha.slice(0, 7)}`);
  const headTreeSha = pickString(headCommit.data, ["tree", "sha"]);

  const blobShaByPath = await createBlobs(ports, repo, files);
  const tree = await ports.send(treeRequest(repo, headTreeSha, buildTreeEntries(files, blobShaByPath)));
  requireStatus(tree, 201, "creating tree");

  const commit = await ports.send(
    commitRequest(repo, { message, treeSha: pickString(tree.data, ["sha"]), parentSha: headSha }),
  );
  requireStatus(commit, 201, "creating commit");

  const moved = await ports.send(updateRefRequest(repo, headBranch, pickString(commit.data, ["sha"])));
  requireStatus(moved, 200, `updating branch ${headBranch}`);
}

async function readText(ports: CreatePrPorts, repo: RepoRef, path: string, ref: string): Promise<string | null> {
  const res = await ports.send(contentsRequest(repo, path, ref));
  if (res.status !== 200) return null;
  const content = parseFileContent(res.data);
  return content === null ? null : decodeBase64(content);
}

/** Versions raised, or — when the commit only stamps changelog entries — the roots whose changelog it stamps. */
function commitMessage(bumped: readonly { root: string; to: string }[], files: readonly ChangedFile[]): string {
  if (bumped.length > 0) return `chore(version): ${bumped.map(({ root, to }) => `${root} → ${to}`).join(", ")}`;
  const roots = [...new Set(files.map((file) => file.path.split("/")[0]))];
  return `chore(changelog): ${roots.join(", ")}`;
}

function messageOf(data: unknown): string {
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "no message";
}
