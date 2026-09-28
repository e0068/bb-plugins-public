// Layer 1 — which of bb's plugin commands brings a touched plugin onto the
// code the merge just landed. Zero effects: the installed source arrives as
// an argument, the answer is a value; src/wiring/plugin-reinstall.ts runs it.
//
// bb updates in place only a plugin whose source tracks the repository the
// PR merged into: `applyUpdate` on a `path:` install (a live preview from a
// worktree), on npm, or on git of another repository is "pinned — stays put"
// (bb guide plugins), which is the refusal this used to surface after every
// merge. Everything else has to be removed and installed afresh from git,
// and since `remove` deletes the plugin's settings, secrets and schedules,
// that step is proposed to the user rather than taken.
import { parseGithubRemote, type RepoRef } from "./remote";

/** A bb install source for one plugin directory of the PR's repository. */
export interface GitTarget {
  readonly source: string;
  readonly subdirectory: string;
}

/** A remove-and-install waiting for the user's word; everything the repoint needs. */
export interface PendingRepoint {
  readonly pluginId: string;
  /** The source bb holds now — what the user is asked to give up. */
  readonly from: string;
  readonly source: string;
  readonly subdirectory: string;
}

/**
 * The facts a reinstall that threw needs to show: which plugin, the source it
 * could not come from, and the build that stays in place meanwhile.
 */
export interface ReinstallFailure {
  readonly pluginId: string;
  /** The source bb was asked to (re)install from — "откуда не получилось". */
  readonly attemptedSource: string;
  /** The version bb still holds under the id, or `null` when nothing was installed. */
  readonly installedVersion: string | null;
  /** Why the step failed — the host's own words. */
  readonly reason: string;
}

/**
 * One `problems` line for a reinstall that threw. Names the plugin, the source
 * it could not come from and — when a build was already installed — the version
 * that stays running, so a merge read hours later says which plugin, from
 * where, and what is installed now instead of it. The "Plugin not reinstalled:"
 * prefix is added by the notification (src/core/notification.ts).
 */
export function reinstallFailureLine({
  pluginId,
  attemptedSource,
  installedVersion,
  reason,
}: ReinstallFailure): string {
  const stays = installedVersion === null ? "" : `, version ${installedVersion} still installed`;
  return `"${pluginId}" from ${attemptedSource}${stays}: ${reason}`;
}

export type ReinstallStep =
  /** Same repository already tracked — `applyUpdate` brings the new build. */
  | { readonly kind: "update" }
  /**
   * The same update, for the plugin running this merge — and so not a step to
   * take here: `applyUpdate` on ourselves invalidates this plugin's API
   * handle. Named apart so the caller runs it after everything else.
   */
  | { readonly kind: "update-self" }
  /** Nothing under this id — a plain install, nothing to lose. */
  | { readonly kind: "install"; readonly target: GitTarget }
  /** Another source — remove and install, only with the user's word. */
  | { readonly kind: "repoint"; readonly from: string; readonly target: GitTarget }
  /** Cannot be done from here; the reason is what the user sees. */
  | { readonly kind: "refuse"; readonly reason: string };

export interface PlanInput {
  readonly pluginId: string;
  /** What bb holds under the id right now; `null` when nothing. */
  readonly installedSource: string | null;
  readonly repo: RepoRef;
  /** The PR's base branch — the ref a fresh install tracks. */
  readonly baseBranch: string;
  /** The id of the plugin running this code (see plugin-paths.ts). */
  readonly ownPluginId: string;
}

const PLUGIN_DIR_PREFIX = "bb-plugin-";

/** `git:https://github.com/<owner>/<repo>.git@<branch>` plus the plugin's own directory. */
export function gitTarget(repo: RepoRef, baseBranch: string, pluginId: string): GitTarget {
  return {
    source: `git:https://github.com/${repo.owner}/${repo.repo}.git@${baseBranch}`,
    subdirectory: `${PLUGIN_DIR_PREFIX}${pluginId}`,
  };
}

/**
 * The GitHub repository a `git:` source points at, or `null` for any other
 * source. The ref after `@` is dropped first — it may itself contain `/`
 * (`@semver:tasks-plus/:^0.1.0`), so "the `@` after the last `/`" would miss
 * it; the ref's `@` is the first one inside the path, which keeps `user@host`
 * out of the way. A scheme-less `github.com/o/r` is read as https.
 */
export function repositoryOfSource(source: string): RepoRef | null {
  if (!source.startsWith("git:")) return null;
  const url = withoutRef(source.slice("git:".length));
  return parseGithubRemote(url.includes("://") || url.includes("@") ? url : `https://${url}`);
}

function withoutRef(url: string): string {
  const afterScheme = url.includes("://") ? url.slice(url.indexOf("://") + 3) : url;
  const pathStart = afterScheme.search(/[/:]/);
  if (pathStart === -1) return url;
  const path = afterScheme.slice(pathStart + 1);
  const at = path.indexOf("@");
  return at === -1 ? url : url.slice(0, url.length - path.length + at);
}

function sameRepository(a: RepoRef, b: RepoRef): boolean {
  return a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase();
}

/** Total: every input names exactly one step. */
export function planReinstall(input: PlanInput): ReinstallStep {
  const { pluginId, installedSource, repo, baseBranch, ownPluginId } = input;
  const target = gitTarget(repo, baseBranch, pluginId);
  if (installedSource === null) return { kind: "install", target };
  const installedRepo = repositoryOfSource(installedSource);
  if (installedRepo !== null && sameRepository(installedRepo, repo)) {
    return pluginId === ownPluginId ? { kind: "update-self" } : { kind: "update" };
  }
  if (pluginId === ownPluginId) {
    return {
      kind: "refuse",
      reason: `${pluginId} is installed from ${installedSource}; removing the plugin that runs this merge would leave it uninstalled — repoint it by hand with bb plugin remove and bb plugin install`,
    };
  }
  return { kind: "repoint", from: installedSource, target };
}
