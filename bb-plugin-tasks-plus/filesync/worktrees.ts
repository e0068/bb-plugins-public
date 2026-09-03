import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { WorktreeSource } from "./merge.js";

/**
 * Active worktree environments for a bb project: one entry per environment
 * that backs at least one live (non-archived, non-deleted) thread.
 *
 * `bb.sdk.threads.list` items already carry `environmentId`,
 * `environmentName`, `environmentBranchName` and
 * `environmentWorkspaceDisplayKind` directly — no per-thread or
 * per-environment follow-up call needed. `environmentWorkspaceDisplayKind
 * === "other"` is the project's main checkout (or no environment at all),
 * which this deliberately excludes: that source is already scanned
 * separately as "main" (see filesync/run.ts).
 *
 * When more than one live thread shares an environment, the environment's
 * `updatedAt` is the most recent of them.
 *
 * Never throws: worktree awareness is an addition on top of the main-
 * checkout sync that already worked without ever calling `threads.list`, so
 * a host/version that can't answer it (missing permission, older bb, a test
 * double with nothing stubbed) must fall back to "no active worktrees"
 * rather than break that existing sync.
 */
export async function listActiveWorktreeSources(
  bb: BbPluginApi,
  bbProjectId: string,
): Promise<WorktreeSource[]> {
  let threads: Awaited<ReturnType<typeof bb.sdk.threads.list>>;
  try {
    threads = await bb.sdk.threads.list({
      projectId: bbProjectId,
      archived: false,
    });
  } catch {
    return [];
  }
  const bySource = new Map<string, WorktreeSource>();
  for (const thread of threads) {
    if (thread.deletedAt !== null) continue;
    if (thread.environmentId === null) continue;
    if (thread.environmentWorkspaceDisplayKind === "other") continue;

    const existing = bySource.get(thread.environmentId);
    if (existing && existing.updatedAt >= thread.updatedAt) continue;
    bySource.set(thread.environmentId, {
      environmentId: thread.environmentId,
      name: thread.environmentName,
      branchName: thread.environmentBranchName,
      updatedAt: thread.updatedAt,
    });
  }
  return [...bySource.values()];
}
