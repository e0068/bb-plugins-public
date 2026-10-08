// Разбор файлов, из которых собирается каталог исполнителей этапа: агент Claude
// Code — markdown с фронтматтером, сохранённый workflow — скрипт с
// `export const meta`. Чистые функции над текстом файла; читает диск сервер.
import type { ExecutorOrigin, SkillOrigin, StageCatalog, StageExecutor } from "../shared/contract";
import { frontmatter } from "./frontmatter";

/** Поставщик агентов из `~/.claude/agents` — по нему виджет берёт иконку. */
export const CLAUDE_CODE_PROVIDER = "claude-code";

const optional = (key: string, value: string | undefined): Record<string, string> => (value === undefined || value === "" ? {} : { [key]: value });

/** Агент из фронтматтера: без имени — не агент. */
export const parseAgentFile = (text: string): StageExecutor | null => {
  const fields = frontmatter(text);
  const name = fields?.name;
  if (fields === null || name === undefined || name === "") return null;
  return { id: `agent:${name}`, kind: "agent", name, ...optional("description", fields.description), ...optional("model", fields.model), provider: CLAUDE_CODE_PROVIDER };
};

const metaField = (meta: string, key: string): string | undefined => new RegExp(`\\b${key}\\s*:\\s*(["'\`])((?:\\\\.|(?!\\1).)*)\\1`).exec(meta)?.[2];

/** Workflow из `export const meta = { name, description }`: без имени — не workflow. */
export const parseWorkflowFile = (text: string): StageExecutor | null => {
  const meta = /export\s+const\s+meta\s*=\s*\{([\s\S]*?)\n?\}/.exec(text)?.[1];
  const name = meta === undefined ? undefined : metaField(meta, "name");
  if (meta === undefined || name === undefined || name === "") return null;
  return { id: `workflow:${name}`, kind: "workflow", name, ...optional("description", metaField(meta, "description")) };
};

/**
 * Агент Codex из `~/.codex/agents/*.toml`: строковые ключи верхнего уровня; без имени — не агент. Id `agent:codex/<имя>` отличает его
 * от одноимённого агента Claude Code — бриф и прогресс ищут исполнителя по id — и от агента плагина Claude Code `codex` (`agent:codex:<имя>`).
 */
export const parseCodexAgentFile = (text: string): StageExecutor | null => {
  const fields = tomlTopStrings(text);
  const name = fields.name;
  if (name === undefined || name === "") return null;
  return { id: `agent:${CODEX_PROVIDER}/${name}`, kind: "agent", name, ...optional("description", fields.description), ...optional("model", fields.model), provider: CODEX_PROVIDER };
};

/** Поставщик агентов из `~/.codex/agents`. */
export const CODEX_PROVIDER = "codex";

type TomlScan = { fields: Record<string, string>; inTriple: boolean; done: boolean };

const unescapeBasic = (raw: string): string => {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
};

/** Строки `ключ = "значение"` до первой таблицы; строки внутри `"""…"""` — не ключи, первый ключ выигрывает. */
const tomlTopStrings = (text: string): Record<string, string> =>
  text.split(/\r?\n/).reduce<TomlScan>(
    (scan, line) => {
      if (scan.done || (!scan.inTriple && /^\s*\[/.test(line))) return { ...scan, done: true };
      const pair = scan.inTriple ? null : /^\s*([A-Za-z_][\w-]*)\s*=\s*"((?:\\.|[^"\\])*)"\s*(?:#.*)?$/.exec(line);
      const fields = pair === null || pair[1]! in scan.fields ? scan.fields : { ...scan.fields, [pair[1]!]: unescapeBasic(pair[2]!) };
      const toggles = (line.split('"""').length - 1) % 2 === 1;
      return { fields, inTriple: toggles ? !scan.inTriple : scan.inTriple, done: false };
    },
    { fields: {}, inTriple: false, done: false },
  ).fields;

const parseJson = (text: string | null): unknown => {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const record = (value: unknown): Record<string, unknown> | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

/**
 * Папки установленных плагинов Claude Code из `~/.claude/plugins/installed_plugins.json` с именем плагина до `@`;
 * плагин, выключенный в `enabledPlugins` настроек, не берётся. Битый список — ни одного плагина, битые настройки — все.
 */
export const installedPluginDirs = (installed: string, settings: string | null): Array<{ plugin: string; dir: string }> =>
  installedPlugins(installed, settings).map(({ plugin, dir }) => ({ plugin, dir }));

/** Ключи `плагин@маркетплейс`, которые владелец выключил в `enabledPlugins` настроек; битые настройки — ни одного. */
export const disabledPluginKeys = (settings: string | null): Set<string> =>
  new Set(Object.entries(record(record(parseJson(settings))?.enabledPlugins) ?? {}).flatMap(([key, on]) => (on === false ? [key] : [])));

/** Имя плагина, синхронизированного с claude.ai: из его plugin.json, иначе по папке до «~» — `design~g2` это `design`. */
export const syncedPluginName = (manifest: string | null, dirName: string): string => {
  const name = record(parseJson(manifest))?.name;
  return typeof name === "string" && name !== "" ? name : dirName.split("~")[0]!;
};

/** То же с ключом `плагин@маркетплейс`, под которым плагин стоит в `enabledPlugins`. */
export const installedPlugins = (installed: string, settings: string | null): Array<{ key: string; plugin: string; dir: string }> => {
  const plugins = record(record(parseJson(installed))?.plugins) ?? {};
  const enabled = record(record(parseJson(settings))?.enabledPlugins) ?? {};
  return Object.entries(plugins).flatMap(([key, installs]) => {
    const dir = Array.isArray(installs) ? record(installs[0])?.installPath : undefined;
    return typeof dir === "string" && enabled[key] !== false ? [{ key, plugin: key.split("@")[0]!, dir }] : [];
  });
};

type CatalogSkill = StageCatalog["skills"][number];

const OWN: SkillOrigin = { kind: "own" };

/** Источник навыка по области и плагину из списка навыков bb: `plugin` — плагин, `*-project` — проект, остальное — свой. */
export const skillOrigin = ({ scope, pluginId, provider }: { scope?: string; pluginId?: string | null; provider?: string | null }): SkillOrigin => {
  if (scope === "plugin" && pluginId != null && pluginId !== "") return provider == null ? { kind: "plugin", plugin: pluginId } : { kind: "plugin", plugin: pluginId, provider };
  return scope?.endsWith("-project") ? { kind: "project" } : OWN;
};

/** Порядок групп строкой: свои, проекта, плагины bb по имени, плагины провайдеров по провайдеру и имени. */
const skillRank = (origin: SkillOrigin): string => {
  switch (origin.kind) {
    case "own":
      return "0";
    case "project":
      return "1";
    case "plugin":
      return origin.provider === undefined ? `2:${origin.plugin}` : `3:${origin.provider}:${origin.plugin}`;
  }
};

/** Элементы группами по рангу группы, группы — по рангу; внутри группы — порядок входа. */
const groupByRank = <T, G>(items: readonly T[], groupOf: (item: T) => G, rankOf: (group: G) => string): Array<{ group: G; items: T[] }> => {
  const groups = items.reduce((acc, item) => {
    const group = groupOf(item);
    const rank = rankOf(group);
    const seen = acc.get(rank);
    return acc.set(rank, { group: seen?.group ?? group, items: [...(seen?.items ?? []), item] });
  }, new Map<string, { group: G; items: T[] }>());
  return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, group]) => group);
};

/** Навыки списка выбора группами по источнику, внутри группы — по имени; навык без источника — свой. */
export const skillGroups = <S extends CatalogSkill>(skills: readonly S[]): Array<{ origin: SkillOrigin; skills: S[] }> =>
  groupByRank([...skills].sort((a, b) => a.name.localeCompare(b.name)), (skill) => skill.origin ?? OWN, skillRank).map(({ group, items }) => ({ origin: group, skills: items }));

/** Имя навыка в строке списка: у навыка плагина провайдера префикс `плагин:` снят — плагин назван заголовком группы. */
export const skillShortName = (skill: CatalogSkill): string => {
  const origin = skill.origin ?? OWN;
  const prefix = origin.kind === "plugin" && origin.provider !== undefined ? `${origin.plugin}:` : null;
  return prefix !== null && skill.name.startsWith(prefix) ? skill.name.slice(prefix.length) : skill.name;
};

/** Группа меню исполнителей. */
export type ExecutorGroup = ExecutorOrigin | { kind: "codex" } | { kind: "workflow" };

const executorGroupOf = (executor: StageExecutor): ExecutorGroup => {
  if (executor.kind === "workflow") return { kind: "workflow" };
  if (executor.provider === CODEX_PROVIDER) return { kind: "codex" };
  return executor.origin ?? { kind: "own" };
};

const executorRank = (group: ExecutorGroup): string => {
  switch (group.kind) {
    case "own":
      return "0";
    case "project":
      return `1:${group.project}`;
    case "plugin":
      return `2:${group.plugin}`;
    case "codex":
      return "3";
    case "workflow":
      return "4";
  }
};

/** Исполнители меню группами: мои, проекты, плагины, Codex, workflow; внутри группы — порядок каталога. */
export const executorGroups = (executors: readonly StageExecutor[]): Array<{ group: ExecutorGroup; executors: StageExecutor[] }> =>
  groupByRank(executors, executorGroupOf, executorRank).map(({ group, items }) => ({ group, executors: items }));
