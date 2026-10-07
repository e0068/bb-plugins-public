// Что агенту треда видно по flow: навыки и агенты открытых этапов — пройденных и текущего, — а остальное прячется
// настройками Claude Code в .claude/settings.local.json дерева треда. Свой навык прячет `skillOverrides` «off», свой
// агент — `Agent(<тип>)` в `permissions.deny`; навыки плагинов `skillOverrides` не трогает, поэтому плагин, ничего не
// дающий flow, выключается целиком в `enabledPlugins`. Здесь только решение; файл пишет ../server/skill-scope.ts.
import type { Flow, FlowProgress, StageCatalog, WorkStage } from "../shared/contract";

/** Имена навыков и типы агентов — так, как их называет Claude Code. */
export type Scope = { skills: readonly string[]; agents: readonly string[] };
/** Что Flow прячет: имена своих навыков, типы агентов и ключи плагинов `плагин@маркетплейс`. */
export type Hidden = { skills: readonly string[]; agents: readonly string[]; plugins: readonly string[] };
export type Limits = { skills: boolean; agents: boolean };
/** Плагин Claude Code: ключ в `enabledPlugins` и имя, которым он префиксует свои навыки и агентов. */
export type ClaudePlugin = { key: string; name: string };

export const EMPTY_SCOPE: Scope = { skills: [], agents: [] };
export const NOTHING_HIDDEN: Hidden = { skills: [], agents: [], plugins: [] };
/** Встроенные агенты Claude Code: в каталоге их нет, файлов у них нет. */
export const BUILTIN_AGENTS: readonly string[] = ["general-purpose", "Explore", "Plan", "statusline-setup"];

const AGENT_PREFIX = "agent:";
const WORKFLOW_PREFIX = "workflow:";
/** Агенты Codex живут в своём каталоге, Claude Code о них не знает. */
const CODEX_AGENT_PREFIX = `${AGENT_PREFIX}codex/`;

const distinct = (names: readonly string[]): string[] => [...new Set(names)];
const outside = (names: readonly string[], kept: readonly string[]): string[] => distinct(names).filter((name) => !kept.includes(name));

export const limitsOf = (flow: Pick<Flow, "limitSkills" | "limitAgents">): Limits => ({ skills: flow.limitSkills === true, agents: flow.limitAgents === true });

const finished = (track: FlowProgress["stages"][string] | undefined): boolean => track?.finishedAt !== undefined || track?.skipped === true;

/** Этапы верхнего уровня по порядку до первого незавершённого включительно — с их подэтапами; без прогона — первый. */
export const openStages = (stages: readonly WorkStage[], progress: FlowProgress | null): WorkStage[] => {
  const tops = stages.filter((stage) => stage.parent === undefined);
  const current = tops.findIndex((stage) => !finished(progress?.stages[stage.id]));
  const open = new Set(tops.slice(0, current === -1 ? tops.length : current + 1).map((stage) => stage.id));
  return stages.filter((stage) => open.has(stage.parent ?? stage.id));
};

/** Навыки и агенты этапов; агенты workflow — те, что названы в его скрипте. */
export const scopeOf = (stages: readonly WorkStage[], workflowAgents: (workflowId: string) => readonly string[]): Scope => {
  const executors = stages.flatMap((stage) => stage.executors.map((executor) => executor.id));
  return {
    skills: distinct(stages.flatMap((stage) => (stage.skill === "" ? [] : [stage.skill]))),
    agents: distinct(
      executors.flatMap((id) => (id.startsWith(WORKFLOW_PREFIX) ? workflowAgents(id) : id.startsWith(AGENT_PREFIX) ? [id.slice(AGENT_PREFIX.length)] : [])),
    ),
  };
};

export const unite = (a: Scope, b: Scope): Scope => ({ skills: distinct([...a.skills, ...b.skills]), agents: distinct([...a.agents, ...b.agents]) });

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Имена агентов, стоящие в скрипте строкой в кавычках: подстрока чужого имени не в счёт. */
export const agentsNamedIn = (script: string, names: readonly string[]): string[] =>
  names.filter((name) => new RegExp(`(["'\`])${escape(name)}\\1`).test(script));

type CatalogSkill = StageCatalog["skills"][number];

/** Свой навык — пользователя или проекта; навык плагина bb или другого провайдера Claude Code не прячет. */
const isOwnSkill = ({ origin }: CatalogSkill): boolean => origin === undefined || origin.kind !== "plugin";
const pluginOfSkill = ({ origin }: CatalogSkill): string | undefined => (origin?.kind === "plugin" && origin.provider === "claude-code" ? origin.plugin : undefined);

/** Агенты Claude Code каталога: тип, каким его зовёт инструмент Agent, и плагин, если агент из плагина. */
const claudeAgents = (catalog: StageCatalog): Array<{ type: string; plugin: string | undefined }> =>
  catalog.executors.flatMap((executor) =>
    executor.kind === "agent" && !executor.id.startsWith(CODEX_AGENT_PREFIX)
      ? [{ type: executor.id.slice(AGENT_PREFIX.length), plugin: executor.origin?.kind === "plugin" ? executor.origin.plugin : undefined }]
      : [],
  );

/**
 * Что спрятать. `opened` — открытое по этапам, `needed` — всё, что нужно flow целиком: плагин включается или
 * выключается только в начале сессии, поэтому решается на весь flow сразу. Плагин выключается, когда всё, что он
 * даёт, — под включёнными переключателями и ничего из этого flow не нужно; плагин без навыков и агентов не трогается.
 */
export const hiddenOf = ({ catalog, plugins, limits, opened, needed }: { catalog: StageCatalog; plugins: readonly ClaudePlugin[]; limits: Limits; opened: Scope; needed: Scope }): Hidden => {
  const agents = claudeAgents(catalog);
  const offPlugin = (plugin: ClaudePlugin): boolean => {
    const skills = catalog.skills.filter((skill) => pluginOfSkill(skill) === plugin.name).map((skill) => skill.name);
    const types = agents.filter((agent) => agent.plugin === plugin.name).map((agent) => agent.type);
    const limited = (skills.length === 0 || limits.skills) && (types.length === 0 || limits.agents);
    const used = skills.some((name) => needed.skills.includes(name)) || types.some((type) => needed.agents.includes(type));
    return skills.length + types.length > 0 && limited && !used;
  };
  const off = plugins.filter(offPlugin);
  // Агенты выключенного плагина уходят вместе с ним; агенты включённого прячутся по одному, как свои.
  const shown = agents.filter((agent) => !off.some((plugin) => plugin.name === agent.plugin)).map((agent) => agent.type);
  return {
    skills: limits.skills ? outside(catalog.skills.filter(isOwnSkill).map((skill) => skill.name), opened.skills) : [],
    agents: limits.agents ? outside([...BUILTIN_AGENTS, ...shown], opened.agents) : [],
    plugins: off.map((plugin) => plugin.key),
  };
};

type Json = Record<string, unknown>;

const record = (value: unknown): Json => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {});
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
const denyRule = (type: string): string => `Agent(${type})`;

/** Раздел без записей не остаётся пустым объектом или списком: файл владельца после снятия ограничений — как был. */
const withSection = (json: Json, key: string, value: Json | readonly string[]): Json => {
  const { [key]: _, ...rest } = json;
  const empty = Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0;
  return empty ? rest : { ...rest, [key]: value };
};

const overridesOf = (current: unknown, previous: readonly string[], next: readonly string[]): Json => ({
  ...Object.fromEntries(Object.entries(record(current)).filter(([name]) => !previous.includes(name))),
  ...Object.fromEntries(next.map((name) => [name, "off"])),
});

const pluginsOf = (current: unknown, previous: readonly string[], next: readonly string[]): Json => ({
  ...Object.fromEntries(Object.entries(record(current)).filter(([key]) => !previous.includes(key))),
  ...Object.fromEntries(next.map((key) => [key, false])),
});

const permissionsOf = (current: unknown, previous: readonly string[], next: readonly string[]): Json => {
  const dropped = previous.map(denyRule);
  const deny = [...denied(current).filter((rule) => !dropped.includes(rule)), ...next.map(denyRule)];
  return withSection(record(current), "deny", distinct(deny));
};

const denied = (permissions: unknown): string[] => strings(record(permissions).deny);

/**
 * Что из желаемого Flow вправе записать: имя, которое в файле уже стоит, но не прошлой записью Flow, — ключ владельца.
 * Flow его не присваивает, поэтому и не снимет потом; владелец, явно включивший навык или плагин, так и остаётся при своём.
 */
export const withoutOwnerKeys = (current: Json, previous: Hidden, wanted: Hidden): Hidden => {
  const ownerHas = (present: readonly string[], ours: readonly string[]) => (name: string) => present.includes(name) && !ours.includes(name);
  const overrides = Object.keys(record(current.skillOverrides));
  const rules = denied(current.permissions);
  const plugins = Object.keys(record(current.enabledPlugins));
  return {
    skills: wanted.skills.filter((name) => !ownerHas(overrides, previous.skills)(name)),
    agents: wanted.agents.filter((type) => !ownerHas(rules, previous.agents.map(denyRule))(denyRule(type))),
    plugins: wanted.plugins.filter((key) => !ownerHas(plugins, previous.plugins)(key)),
  };
};

/** Новый JSON .claude/settings.local.json: записи прошлой записи Flow сняты, новые положены, ключи владельца не тронуты. */
export const mergeLocalSettings = (current: Json, previous: Hidden, next: Hidden): Json =>
  [
    (json: Json) => withSection(json, "skillOverrides", overridesOf(json.skillOverrides, previous.skills, next.skills)),
    (json: Json) => withSection(json, "permissions", permissionsOf(json.permissions, previous.agents, next.agents)),
    (json: Json) => withSection(json, "enabledPlugins", pluginsOf(json.enabledPlugins, previous.plugins, next.plugins)),
  ].reduce((json, step) => step(json), current);
