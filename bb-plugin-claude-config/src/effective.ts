// Layer 1 — merging multiple settings scopes into one effective value.
//
// Claude Code reads settings by level and lets a narrower level override a
// broader one: user → project → local → managed. The plugin edits two of
// them (user and local), so the list here goes from broad to narrow, and
// the last level where a value is actually set wins.

import type {
  McpServerState,
  PluginToggle,
  SkillState,
  ToolSearchMode,
} from "./settings-doc";

/** Plugin absent from settings — means it's not enabled. */
const PLUGIN_DEFAULT = "off" as const;
/** Skill absent from skillOverrides — means it's fully visible. */
const SKILL_DEFAULT = "on" as const;
/** Variable unset — Claude Code behaves like `auto` (threshold by count). */
const TOOL_SEARCH_DEFAULT = "auto" as const;

export type EffectivePlugin = Exclude<PluginToggle, "inherit">;
export type EffectiveSkill = Exclude<SkillState, "inherit">;
export type EffectiveToolSearch = Exclude<ToolSearchMode, "inherit">;

export function resolvePlugin(levels: PluginToggle[]): EffectivePlugin {
  return resolve(levels, PLUGIN_DEFAULT);
}

export function resolveSkill(levels: SkillState[]): EffectiveSkill {
  return resolve(levels, SKILL_DEFAULT);
}

export function resolveToolSearch(
  levels: ToolSearchMode[],
): EffectiveToolSearch {
  return resolve(levels, TOOL_SEARCH_DEFAULT);
}

export type EffectiveMcpServer = Exclude<McpServerState, "inherit">;

/**
 * Resolves an MCP server's state. The default depends on
 * `enableAllProjectMcpServers`: when set, a server with no explicit entry is
 * considered enabled, otherwise disabled. An explicit `on`/`off` at any
 * level (last one wins) takes priority over the default.
 */
export function resolveMcpServer(
  levels: McpServerState[],
  enableAll: boolean,
): EffectiveMcpServer {
  return resolve(levels, enableAll ? "on" : "off");
}

/** Effective `enableAllProjectMcpServers`: the last level that sets it, otherwise false. */
export function resolveEnableAllMcp(levels: (boolean | undefined)[]): boolean {
  for (let index = levels.length - 1; index >= 0; index -= 1) {
    const level = levels[index];
    if (level !== undefined) return level;
  }
  return false;
}

/**
 * The MCP server's "own" value for a minimal write: if, after removing the
 * local override, the server would resolve to `target` anyway, write
 * `inherit` (drop it from both arrays); otherwise set it explicitly.
 *
 * `broaderStates` — the server's states at levels broader than the one being
 * edited. `enableAllLevels` — `enableAllProjectMcpServers` at ALL levels,
 * including the one being edited: `setMcpServer` doesn't touch it, so under
 * `inherit` it keeps supplying the default, and without it the decision
 * would use the wrong fallback (the toggle would silently fail to work).
 */
export function decideMcpOwn(
  broaderStates: McpServerState[],
  enableAllLevels: (boolean | undefined)[],
  target: EffectiveMcpServer,
): McpServerState {
  const effectiveIfInherited = resolveMcpServer(
    broaderStates,
    resolveEnableAllMcp(enableAllLevels),
  );
  return effectiveIfInherited === target ? "inherit" : target;
}

function resolve<T extends string>(
  levels: (T | "inherit")[],
  fallback: Exclude<T, "inherit">,
): Exclude<T, "inherit"> {
  for (let index = levels.length - 1; index >= 0; index -= 1) {
    const level = levels[index];
    if (level !== undefined && level !== "inherit") {
      return level as Exclude<T, "inherit">;
    }
  }
  return fallback;
}
