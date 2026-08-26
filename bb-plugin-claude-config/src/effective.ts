// Слой 1 — сведение нескольких областей настроек в одно действующее значение.
//
// Claude Code читает настройки уровнями и берёт более узкий уровень поверх
// более широкого: user → project → local → managed. Плагин правит два из них
// (user и local), поэтому здесь список идёт от широкого к узкому, а побеждает
// последний, где значение вообще задано.

import type {
  McpServerState,
  PluginToggle,
  SkillState,
  ToolSearchMode,
} from "./settings-doc";

/** Плагина нет в настройках — значит он не включён. */
const PLUGIN_DEFAULT = "off" as const;
/** Навыка нет в skillOverrides — значит он виден полностью. */
const SKILL_DEFAULT = "on" as const;
/** Переменная не задана — Claude Code ведёт себя как `auto` (порог по числу). */
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
 * Свёртка состояния MCP-сервера. Умолчание зависит от `enableAllProjectMcpServers`:
 * при нём сервер без явной записи считается включённым, иначе выключенным. Явные
 * `on`/`off` на любом уровне (последний победивший) старше умолчания.
 */
export function resolveMcpServer(
  levels: McpServerState[],
  enableAll: boolean,
): EffectiveMcpServer {
  return resolve(levels, enableAll ? "on" : "off");
}

/** Действующее `enableAllProjectMcpServers`: последний заданный уровень, иначе false. */
export function resolveEnableAllMcp(levels: (boolean | undefined)[]): boolean {
  for (let index = levels.length - 1; index >= 0; index -= 1) {
    const level = levels[index];
    if (level !== undefined) return level;
  }
  return false;
}

/**
 * «Своё» значение MCP-сервера при минимальной записи: если после снятия
 * локального оверрайда сервер и так даст target, пишем `inherit` (вон из обоих
 * массивов), иначе ставим явно.
 *
 * `broaderStates` — состояния сервера на уровнях старше редактируемого.
 * `enableAllLevels` — `enableAllProjectMcpServers` ВСЕХ уровней, включая
 * редактируемый: `setMcpServer` его не трогает, поэтому при `inherit` он
 * продолжает задавать умолчание, и без него решение считается с неверным
 * фолбэком (тумблер бы молча не сработал).
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
