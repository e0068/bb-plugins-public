// Layer 3 (shell) — after a PR has merged, bring every plugin the PR itself
// touched onto the merged code. Uses the host SDK (bb.sdk.plugins) directly —
// no runtime dependency on Plugins Monitor being installed. See
// memory/decisions/reinstall-touched-plugins-direct-sdk.md.
//
// Which plugins: the ones named by the merged PR's own file list (the same
// comparison the merge-time version bump reads, see merge-time-bump.ts) —
// NOT the range the local `main` happened to advance by in the plugin's own
// post-merge pull. See memory/decisions/reinstall-from-merged-pr-files.md.
//
// Which command: decided in src/core/reinstall-plan.ts from the source bb
// holds under the id. An update and a fresh install run here and now; a
// repoint (remove, then install from git) is handed back as pending, because
// `remove` deletes the plugin's settings, secrets and schedules — the front
// end asks, and `repointPlugin` runs on the user's word.
//
// One step is deliberately not taken here: updating the plugin running the
// merge. bb invalidates its API handle as it updates, so it comes back as
// `pendingSelfUpdate` for the RPC handler to run last.
//
// Best-effort with respect to the merge: it has already landed, so a failed
// step must not surface as a failed merge — but it must surface. Each
// outcome is reported by id; a `problems` entry is what the user sees when a
// plugin they just changed keeps running the old build.
import { touchedPluginIds } from "../core/plugin-paths";
import {
  planReinstall,
  reinstallFailureLine,
  type GitTarget,
  type PendingRepoint,
} from "../core/reinstall-plan";
import type { RepoRef } from "../core/remote";

/**
 * The slice of bb.sdk.plugins this needs; the SDK object fits as is. `version`
 * is read to say which build stays installed when a reinstall fails; it is
 * optional here so a fake list without one still satisfies the port.
 */
export interface PluginsPort {
  list(): Promise<{ plugins: readonly { id: string; source: string; version?: string }[] }>;
  applyUpdate(args: { pluginId: string }): Promise<unknown>;
  install(args: { source: string; subdirectory?: string }): Promise<unknown>;
  remove(args: { pluginId: string }): Promise<unknown>;
}

/** What bb holds under an id right now — the facts a failed reinstall reports. */
interface HeldPlugin {
  readonly source: string;
  readonly version: string | null;
}

export interface ReinstallTarget {
  readonly repo: RepoRef;
  readonly baseBranch: string;
  readonly ownPluginId: string;
}

export interface ReinstallReport {
  readonly reinstalled: readonly string[];
  readonly installed: readonly string[];
  readonly repoints: readonly PendingRepoint[];
  readonly problems: readonly string[];
  /** The plugin running this merge, for `applyPendingSelfUpdate` to run last. */
  readonly pendingSelfUpdate: string | null;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const installArgs = ({ source, subdirectory }: GitTarget) => ({ source, subdirectory });

/**
 * Runs the planned step for every distinct plugin id the changed paths name,
 * in path order; reports each outcome. Updates and installs happen here;
 * repoints come back pending.
 */
export async function reinstallTouchedPlugins(
  port: PluginsPort,
  changedPaths: readonly string[],
  target: ReinstallTarget,
): Promise<ReinstallReport> {
  const ids = touchedPluginIds(changedPaths);
  const reinstalled: string[] = [];
  const installed: string[] = [];
  const repoints: PendingRepoint[] = [];
  const problems: string[] = [];
  let pendingSelfUpdate: string | null = null;
  if (ids.length === 0) {
    return { reinstalled, installed, repoints, problems, pendingSelfUpdate };
  }

  const held = new Map<string, HeldPlugin>(
    (await port.list()).plugins.map((plugin) => [
      plugin.id,
      { source: plugin.source, version: plugin.version ?? null },
    ]),
  );
  for (const pluginId of ids) {
    const holds = held.get(pluginId) ?? null;
    const step = planReinstall({
      pluginId,
      installedSource: holds?.source ?? null,
      repo: target.repo,
      baseBranch: target.baseBranch,
      ownPluginId: target.ownPluginId,
    });
    try {
      switch (step.kind) {
        case "update":
          await port.applyUpdate({ pluginId });
          reinstalled.push(pluginId);
          break;
        case "update-self":
          pendingSelfUpdate = pluginId;
          break;
        case "install":
          await port.install(installArgs(step.target));
          installed.push(pluginId);
          break;
        case "repoint":
          repoints.push({ pluginId, from: step.from, ...step.target });
          break;
        case "refuse":
          problems.push(step.reason);
          break;
      }
    } catch (error) {
      // The source it could not come from: a fresh install names its git
      // target; an update names the source bb already held.
      problems.push(
        reinstallFailureLine({
          pluginId,
          attemptedSource: step.kind === "install" ? step.target.source : (holds?.source ?? pluginId),
          installedVersion: holds?.version ?? null,
          reason: message(error),
        }),
      );
    }
  }
  return { reinstalled, installed, repoints, problems, pendingSelfUpdate };
}

/**
 * Update the plugin that ran the merge. Split out because nothing needing
 * `bb.*` may come after it. Best-effort like every step here: a refusal is a
 * `problems` entry, never a failed merge.
 */
export async function applyPendingSelfUpdate(
  port: PluginsPort,
  report: ReinstallReport,
): Promise<ReinstallReport> {
  const pluginId = report.pendingSelfUpdate;
  if (pluginId === null) return report;
  try {
    await port.applyUpdate({ pluginId });
    return { ...report, reinstalled: [...report.reinstalled, pluginId], pendingSelfUpdate: null };
  } catch (error) {
    // A refused self-update leaves the plugin installed as it was, so its own
    // source and version are still on the list — the same three facts.
    const holds = (await port.list()).plugins.find((plugin) => plugin.id === pluginId) ?? null;
    return {
      ...report,
      problems: [
        ...report.problems,
        reinstallFailureLine({
          pluginId,
          attemptedSource: holds?.source ?? pluginId,
          installedVersion: holds?.version ?? null,
          reason: message(error),
        }),
      ],
      pendingSelfUpdate: null,
    };
  }
}

/**
 * Remove whatever bb holds under the id and install from git — the pair bb
 * requires to change a source, and one that is not atomic: if the install
 * fails (no network, a bad spec), the previous source goes back in so a
 * failed repoint never leaves the user with the plugin simply gone. The
 * original failure is what is thrown. Same shape as Plugins Monitor's
 * changeSource, for the same reason.
 */
export async function repointPlugin(
  port: PluginsPort,
  request: { pluginId: string; source: string; subdirectory: string },
): Promise<void> {
  const { pluginId, source, subdirectory } = request;
  const previous = (await port.list()).plugins.find((plugin) => plugin.id === pluginId) ?? null;
  if (previous === null) {
    await port.install({ source, subdirectory });
    return;
  }
  await port.remove({ pluginId });
  try {
    await port.install({ source, subdirectory });
  } catch (cause) {
    try {
      // bb does not report the subdirectory an install used; a git source
      // into this multi-plugin repository needs the plugin's own directory,
      // a path source already points at it.
      await port.install(
        previous.source.startsWith("git:")
          ? { source: previous.source, subdirectory }
          : { source: previous.source },
      );
    } catch {
      // The rollback failed too; the original cause is the one worth reporting.
    }
    throw cause;
  }
}
