// Layer 1 — pure derivation of touched plugin ids from a list of changed git
// paths. Zero effects; reading the paths (git diff) and using the ids
// (applyUpdate) both live in the shell.
//
// The id of the plugin running a chain is NOT here: Flow and Automations run
// their own chains under their own ids, so it is passed in as an argument
// (ReinstallTarget.ownPluginId) instead of being a constant of this layer.
const PLUGIN_DIR_PREFIX = "bb-plugin-";

/**
 * Distinct plugin ids touched by any of the given changed paths — the top
 * path segment of a `bb-plugin-<id>/...` entry, stripped of its prefix.
 * Paths outside any `bb-plugin-*` directory are ignored. Same rule as
 * bb-plugin-plugins-monitor's `idFromPackageName`, kept as its own tiny copy
 * here rather than a cross-plugin import — see
 * memory/decisions/reinstall-touched-plugins-direct-sdk.md.
 */
export function touchedPluginIds(changedPaths: readonly string[]): readonly string[] {
  const ids = new Set<string>();
  for (const path of changedPaths) {
    const top = path.split("/")[0];
    if (top?.startsWith(PLUGIN_DIR_PREFIX)) ids.add(top.slice(PLUGIN_DIR_PREFIX.length));
  }
  return [...ids];
}
