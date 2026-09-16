// Layer 3 (shell), the testable part — folds a patch-version bump for every
// plugin/package touched by the diff into the file list the PR commit is
// built from. The only effect (reading a package.json at two refs, to check
// it's safe to bump) is a port, so this is tested with a fake reader, no
// real network.
import {
  affectedPluginRoots,
  bumpChangedFileVersionWithTarget,
  bumpChangedLockFileVersion,
  resolveLiveBumpSource,
  type FilePayload,
} from "../core/plugin-version-bump";
import { contentsRequest, parseFileContent, type ChangedFile, type RepoRef } from "../core/github-requests";
import type { CreatePrPorts, GithubResponse } from "./create-pr";

export interface VersionBumpPorts {
  /**
   * Reads a plugin/package root's package.json at a specific git ref (a
   * branch name or a commit sha) — not off the local working copy. Resolves
   * to null when the file doesn't exist at that ref: some roots
   * `pluginRootOf` recognizes (e.g. packages/plugin-base, a shared config
   * layer) have no package.json of their own, and that must not fail PR
   * creation.
   */
  readFileAt(ref: string, path: string): Promise<FilePayload | null>;
}

export interface VersionBumpRefs {
  /** The PR's merge-base — the parent of the PR's own commit, and so what any injected bump is three-way-merged against. */
  mergeBase: string;
  /** The base branch's current tip — where a bump target is read from when the diff doesn't already carry one. */
  baseTip: string;
}

/**
 * For each plugin/package root touched by `changedPaths`, bumps its
 * package.json's patch version. Whether it's safe to bump at all is decided
 * the same way regardless of whether the diff already touches the file:
 * both `refs.mergeBase` and `refs.baseTip` are read and compared
 * (`resolveLiveBumpSource`) — because the PR's commit is parented on
 * `refs.mergeBase` either way, so a base that moved this file since then
 * would collide with an injected bump even when the diff's own change to
 * the file was about something else entirely. Disagreement (or the base
 * gate refusing) leaves the root exactly as it already was — the diff's own
 * entry untouched if there was one, otherwise nothing added. Only *what* to
 * bump differs: the diff's own content when present (the author's edit
 * takes priority over the base's), otherwise the base tip's. The author's
 * priority holds even if they already touched "version" themselves — their
 * value is what gets bumped, so a manual 0.1.4 → 0.1.5 edit lands as 0.1.6.
 * A root whose package.json was deleted in this diff, has no package.json
 * anywhere, or has no parseable "version" field is left untouched.
 *
 * package-lock.json follows the same root, one step later: it's bumped to
 * the exact version package.json just landed on (not its own independent
 * patch increment — see `bumpPackageLockVersion`), gated by the identical
 * merge-base/live-tip safety check applied to *its own* content. A root
 * whose package.json bump was itself skipped never reaches this step, since
 * there's no `to` for the lockfile to follow.
 */
export async function applyPluginVersionBumps(
  ports: VersionBumpPorts,
  refs: VersionBumpRefs,
  changedPaths: readonly string[],
  files: readonly ChangedFile[],
): Promise<ChangedFile[]> {
  const result = [...files];
  for (const root of affectedPluginRoots(changedPaths)) {
    const to = await bumpFileInPlace(ports, refs, result, `${root}/package.json`, (file) =>
      bumpChangedFileVersionWithTarget(file),
    );
    if (!to) continue;
    await bumpFileInPlace(ports, refs, result, `${root}/package-lock.json`, (file) => {
      const bumped = bumpChangedLockFileVersion(file, to);
      return bumped ? { file: bumped, to } : null;
    });
  }
  return result;
}

/**
 * Reads one path at both refs, applies the safety gate, and — if `bump`
 * accepts the resulting file — writes the bump into `result` in place
 * (upsert-or-append, mirroring how `mergeBase.files`/GitHub's tree API
 * itself represents a diff). Shared by the package.json and
 * package-lock.json steps above; returns the version the bump landed on, so
 * a caller chaining a second file onto the first can target it exactly.
 */
async function bumpFileInPlace(
  ports: VersionBumpPorts,
  refs: VersionBumpRefs,
  result: ChangedFile[],
  path: string,
  bump: (file: ChangedFile) => { file: ChangedFile; to: string } | null,
): Promise<string | null> {
  const index = result.findIndex((file) => file.path === path);
  const existing = index === -1 ? null : result[index];
  if (existing?.kind === "delete") return null;

  const [atMergeBase, atBaseTip] = await Promise.all([
    ports.readFileAt(refs.mergeBase, path),
    ports.readFileAt(refs.baseTip, path),
  ]);
  const source = resolveLiveBumpSource(atMergeBase, atBaseTip);
  if (!source) return null;

  const file = existing ?? { kind: "upsert" as const, path, ...source };
  const bumped = bump(file);
  if (!bumped) return null;
  if (index === -1) result.push(bumped.file);
  else result[index] = bumped.file;
  return bumped.to;
}

/**
 * The live port: reads a file at a ref via the GitHub Contents API, through
 * the same `send` (and so the same token) the rest of PR creation uses. A
 * 404 is "no file at that ref". Any other non-2xx status is a real
 * GitHub-access problem (auth, rate limit, network) and is thrown, same as
 * the rest of the PR-creation flow does for its own GitHub calls.
 */
export function githubVersionBumpPorts(send: CreatePrPorts["send"], repo: RepoRef): VersionBumpPorts {
  return {
    async readFileAt(ref, path) {
      const res = await send(contentsRequest(repo, path, ref));
      if (res.status === 404) return null;
      requireOk(res, `reading ${path}@${ref} for a version bump`);
      const content = parseFileContent(res.data);
      return content === null ? null : { content, encoding: "base64" };
    },
  };
}

function requireOk(res: GithubResponse, step: string): void {
  if (res.status !== 200) {
    throw new Error(`${step}: GitHub responded HTTP ${res.status}`);
  }
}
