import type { InvalidFile, ScanResult } from "./scan.js";
import type { ScannedFile } from "./sync.js";

/** An active worktree environment a scan can be attributed to — see
 *  filesync/worktrees.ts. */
export interface WorktreeSource {
  environmentId: string;
  name: string | null;
  branchName: string | null;
  /** Most recent activity of a thread backed by this environment, epoch ms.
   *  Breaks ties when the same slug diverges from main in more than one
   *  worktree at once, favoring whichever is most recently active. */
  updatedAt: number;
}

export interface WorktreeScan extends ScanResult {
  source: WorktreeSource;
  /**
   * Repo-relative paths this environment has actually changed relative to
   * its own merge base (committed and uncommitted together) — see
   * filesync/worktree-changes.ts. A worktree's copy of a slug can only win
   * over main when its file's path is in this set.
   *
   * Content alone can't answer "did this environment touch it": a worktree
   * is a full checkout, so at every path it *hasn't* touched, its copy will
   * still legitimately differ from main the moment main moves past that
   * worktree's branch point — an older worktree left running would then look
   * "diverged" and overwrite fresher main content with a stale copy. This
   * set is what tells the two apart.
   */
  changedPaths: ReadonlySet<string>;
}

/**
 * Combines a project's main-checkout scan with scans of its active
 * worktrees into one file per slug.
 *
 * A worktree's copy of a slug only wins over main when both hold:
 * (1) the environment actually changed that file's path (`changedPaths`),
 * and (2) the mapped task content it produces still differs from main's
 * (by `contentSha`) — not incidental byte differences, and not simply
 * "main hasn't caught up to a merge yet" once (1) has already filtered out
 * paths the worktree never touched. Otherwise main's version is kept, even
 * though a worktree also scanned the file.
 *
 * When more than one worktree changes the same slug at once, the most
 * recently active one wins (`WorktreeSource.updatedAt`, tie-broken by
 * `environmentId` for a stable result when two are exactly equal).
 */
export function mergeFileScans(
  main: ScanResult,
  worktrees: readonly WorktreeScan[],
): ScanResult {
  const mainBySlug = new Map(main.files.map((file) => [file.mapped.slug, file]));
  const winners = new Map<string, ScannedFile>(mainBySlug);
  const winnerUpdatedAt = new Map<string, number>();

  const byRecency = [...worktrees].sort((a, b) => {
    const byActivity = b.source.updatedAt - a.source.updatedAt;
    return byActivity !== 0
      ? byActivity
      : a.source.environmentId.localeCompare(b.source.environmentId);
  });
  for (const { source, files, changedPaths } of byRecency) {
    for (const file of files) {
      if (!changedPaths.has(file.filePath)) continue;

      const slug = file.mapped.slug;
      const mainFile = mainBySlug.get(slug);
      const diverged = !mainFile || mainFile.contentSha !== file.contentSha;
      if (!diverged) continue;

      const currentBestUpdatedAt = winnerUpdatedAt.get(slug);
      if (
        currentBestUpdatedAt !== undefined &&
        currentBestUpdatedAt >= source.updatedAt
      ) {
        continue;
      }
      winners.set(slug, file);
      winnerUpdatedAt.set(slug, source.updatedAt);
    }
  }

  const invalidByPath = new Map<string, InvalidFile>();
  for (const invalid of main.invalid) invalidByPath.set(invalid.filePath, invalid);
  for (const worktree of worktrees) {
    for (const invalid of worktree.invalid) {
      if (!invalidByPath.has(invalid.filePath)) {
        invalidByPath.set(invalid.filePath, invalid);
      }
    }
  }

  return { files: [...winners.values()], invalid: [...invalidByPath.values()] };
}
