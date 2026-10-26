// Layer 3 (shell) — after `Pull Main` moved the integration copy, rebuild the
// plugins bb runs from its folders whose code moved with it (BBPL-962).
// Which ones: core/local-refresh.ts over the files the pull changed — the
// plugin's own folder or a shared package it builds (core/package-consumers.ts).
// How: `install` from the same `path:` — bb builds it again and keeps its
// settings, secrets and schedules; `applyUpdate` leaves a pinned `path:` as is.
//
// The plugin running the step is not reinstalled here: that would drop its
// API handle mid-chain. It comes back as `pendingSelf` for the chain to
// reinstall once everything else is done.
import { changedSinceAtArgs, headAtArgs, worktreeListArgs } from "../core/git-commands";
import { findBaseCheckout, parseWorktreeList } from "../core/git-worktrees";
import { localRefreshes } from "../core/local-refresh";
import { changedPackages, touchedPlugins } from "../core/package-consumers";
import { reinstallFailureLine } from "../core/reinstall-plan";
import type { GitPorts } from "./git-run";
import type { PluginImports } from "./plugin-imports";
import type { PluginsPort } from "./plugin-reinstall";

/** The worktree with the base checked out and the commit it stood on before the pull. */
export interface BaseCheckout {
  readonly path: string;
  readonly head: string;
}

export interface LocalRefreshReport {
  readonly refreshed: readonly string[];
  readonly problems: readonly string[];
  /** The plugin running the step, to reinstall after the chain. */
  readonly pendingSelf: string | null;
}

const NOTHING: LocalRefreshReport = { refreshed: [], problems: [], pendingSelf: null };

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Where the base is checked out and its commit — read before the pull; `null` when it is checked out nowhere. */
export async function headOfBaseCheckout(git: GitPorts, base: string): Promise<BaseCheckout | null> {
  const listed = await git.run(worktreeListArgs());
  const path = listed.code === 0 ? findBaseCheckout(parseWorktreeList(listed.stdout), base) : null;
  if (path === null) return null;
  const head = await git.run(headAtArgs(path));
  return head.code === 0 ? { path, head: head.stdout.trim() } : null;
}

/** Reinstalls every touched plugin bb runs from the checkout's folders; a failed one is a problem, the rest still go. */
export async function refreshLocalPlugins(
  port: PluginsPort,
  git: GitPorts,
  before: BaseCheckout,
  ownPluginId: string,
  readImports: () => Promise<PluginImports>,
): Promise<LocalRefreshReport> {
  const diff = await git.run(changedSinceAtArgs(before.path, before.head));
  if (diff.code !== 0) return { ...NOTHING, problems: [`files changed by the pull not read: ${diff.stderr.trim() || `code ${diff.code}`}`] };
  const changed = diff.stdout.split("\n").filter((line) => line.trim() !== "");
  if (changed.length === 0) return NOTHING;
  const imports = changedPackages(changed).length === 0 ? { ok: true as const, edges: [] } : await readImports();
  const { direct, viaPackage } = touchedPlugins(changed, imports.ok ? imports.edges : []);
  const held = (await port.list()).plugins;
  const refreshed: string[] = [];
  const problems: string[] = imports.ok ? [] : [`plugins that build ${changedPackages(changed).map((name) => `packages/${name}`).join(", ")} not found: ${imports.reason}`];
  let pendingSelf: string | null = null;
  for (const { pluginId, source } of localRefreshes(held, before.path, [...direct, ...viaPackage])) {
    if (pluginId === ownPluginId) {
      pendingSelf = pluginId;
      continue;
    }
    try {
      await port.install({ source });
      refreshed.push(pluginId);
    } catch (error) {
      const version = held.find((plugin) => plugin.id === pluginId)?.version ?? null;
      problems.push(reinstallFailureLine({ pluginId, attemptedSource: source, installedVersion: version, reason: message(error) }));
    }
  }
  return { refreshed, problems, pendingSelf };
}
