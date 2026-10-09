// Что агенту треда видно по flow: навыки и агенты открытых этапов — пройденных, текущего и следующего, — а остальное прячется
// настройками Claude Code в .claude/settings.local.json дерева треда. `skillOverrides` «off» прячет свой навык, навык
// аккаунта claude.ai и свой workflow, `disableBundledSkills` — встроенные навыки Claude Code, `Agent(<тип>)` в
// `permissions.deny` — агента. Навыки плагинов `skillOverrides` не трогает, а запрет `Skill(<имя>)` из списка их не
// убирает, поэтому плагин, ничего не дающий flow, выключается целиком в `enabledPlugins` — и синхронизированный с
// claude.ai, и тот, где одни команды. Здесь только решение; файл пишет ../server/skill-scope.ts.
import type { Flow, FlowProgress, FlowSettings, StageCatalog, WorkStage } from "../shared/contract";

/** Имена навыков, типы агентов и имена workflow — так, как их называет Claude Code. */
export type Scope = { skills: readonly string[]; agents: readonly string[]; workflows?: readonly string[] };
/**
 * Что Flow прячет: имена навыков и workflow для `skillOverrides`, типы агентов, ключи плагинов `плагин@маркетплейс`
 * и встроенные навыки Claude Code разом.
 */
export type Hidden = { skills: readonly string[]; agents: readonly string[]; plugins: readonly string[]; bundled?: boolean };
export type Limits = { skills: boolean; agents: boolean };
/**
 * Плагин Claude Code: ключ в `enabledPlugins`, имя, которым он префиксует свои навыки и агентов, и навыки с командами
 * `плагин:имя`, прочитанные из его папки, — их нет в каталоге bb у плагинов, синхронизированных с claude.ai, и у команд.
 */
export type ClaudePlugin = { key: string; name: string; skills?: readonly string[] };

export const EMPTY_SCOPE: Scope = { skills: [], agents: [], workflows: [] };
export const NOTHING_HIDDEN: Hidden = { skills: [], agents: [], plugins: [], bundled: false };
/** Встроенные агенты Claude Code: в каталоге их нет, файлов у них нет. */
export const BUILTIN_AGENTS: readonly string[] = ["general-purpose", "Explore", "Plan", "statusline-setup"];

const AGENT_PREFIX = "agent:";
const WORKFLOW_PREFIX = "workflow:";
/** Агенты Codex живут в своём каталоге, Claude Code о них не знает. */
const CODEX_AGENT_PREFIX = `${AGENT_PREFIX}codex/`;

const distinct = (names: readonly string[]): string[] => [...new Set(names)];
const outside = (names: readonly string[], kept: readonly string[]): string[] => distinct(names).filter((name) => !kept.includes(name));

export const limitsOf = (flow: Pick<Flow, "limitSkills" | "limitAgents">): Limits => ({ skills: flow.limitSkills === true, agents: flow.limitAgents === true });

const NO_LIMITS: Limits = { skills: false, agents: false };

/** Тред, которому flow ещё выберет агент: прячется то, что прячет хоть один flow, — выбор потом только откроет. */
export const limitsOfAny = (flows: ReadonlyArray<Pick<Flow, "limitSkills" | "limitAgents">>): Limits =>
  flows.map(limitsOf).reduce((a, b) => ({ skills: a.skills || b.skills, agents: a.agents || b.agents }), NO_LIMITS);

/** Тумблер «Очищать контекст после автоматического выбора flow»: нет поля — включён. */
export const clearsContextAfterAutoChoice = (settings: Pick<FlowSettings, "clearContextAfterAutoChoice">): boolean => settings.clearContextAfterAutoChoice ?? true;

/** Что прятать до выбора flow агентом. Без очистки после выбора не прячется ничего: урезанная сессия так и осталась бы урезанной. */
export const limitsBeforeChoice = (settings: Pick<FlowSettings, "clearContextAfterAutoChoice"> & { flows: ReadonlyArray<Pick<Flow, "limitSkills" | "limitAgents">> }): Limits =>
  clearsContextAfterAutoChoice(settings) ? limitsOfAny(settings.flows) : NO_LIMITS;

/**
 * Начинать ли тред заново после выбора агентом: по тумблеру — когда flow выбран, и всегда, когда сессия стартовала
 * урезанной, — иначе навыки не вернутся.
 */
export const restartsAfterChoice = (choice: { clears: boolean; chosen: boolean; limitedBeforeChoice: boolean }): boolean =>
  choice.limitedBeforeChoice || (choice.clears && choice.chosen);

const finished = (track: FlowProgress["stages"][string] | undefined): boolean => track?.finishedAt !== undefined || track?.skipped === true;

/** Этап, которому есть что открыть: навык или исполнители у него самого или у его подэтапов. */
const working = (stages: readonly WorkStage[], top: WorkStage): boolean =>
  stages.some((stage) => (stage.parent ?? stage.id) === top.id && (stage.skill !== "" || stage.executors.length > 0));

/**
 * Этапы верхнего уровня по порядку до первого незавершённого включительно и дальше до следующего рабочего этапа — с их
 * подэтапами; без прогона текущий — первый. Следующий открыт заранее: Claude Code замечает файл настроек не сразу, а
 * агент зовёт навык этапа сразу после отметки. Автоматизация и демонстрация навыка не несут и следующим не считаются.
 */
export const openStages = (stages: readonly WorkStage[], progress: FlowProgress | null): WorkStage[] => {
  const tops = stages.filter((stage) => stage.parent === undefined);
  const current = tops.findIndex((stage) => !finished(progress?.stages[stage.id]));
  const ahead = current === -1 ? -1 : tops.findIndex((stage, index) => index > current && working(stages, stage));
  const last = current === -1 || ahead === -1 ? tops.length : ahead + 1;
  const open = new Set(tops.slice(0, last).map((stage) => stage.id));
  return stages.filter((stage) => open.has(stage.parent ?? stage.id));
};

/** Навыки, агенты и workflow этапов; агенты workflow — те, что названы в его скрипте. */
export const scopeOf = (stages: readonly WorkStage[], workflowAgents: (workflowId: string) => readonly string[]): Scope => {
  const executors = stages.flatMap((stage) => stage.executors.map((executor) => executor.id));
  return {
    skills: distinct(stages.flatMap((stage) => (stage.skill === "" ? [] : [stage.skill]))),
    agents: distinct(
      executors.flatMap((id) => (id.startsWith(WORKFLOW_PREFIX) ? workflowAgents(id) : id.startsWith(AGENT_PREFIX) ? [id.slice(AGENT_PREFIX.length)] : [])),
    ),
    workflows: distinct(executors.flatMap((id) => (id.startsWith(WORKFLOW_PREFIX) ? [id.slice(WORKFLOW_PREFIX.length)] : []))),
  };
};

export const unite = (a: Scope, b: Scope): Scope => ({
  skills: distinct([...a.skills, ...b.skills]),
  agents: distinct([...a.agents, ...b.agents]),
  workflows: distinct([...(a.workflows ?? []), ...(b.workflows ?? [])]),
});

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

/** Workflow каталога по имени — Claude Code показывает их агенту в одном списке с навыками. */
const workflowNames = (catalog: StageCatalog): string[] =>
  catalog.executors.flatMap((executor) => (executor.kind === "workflow" ? [executor.id.slice(WORKFLOW_PREFIX.length)] : []));

/**
 * Что спрятать. `opened` — открытое по этапам, `needed` — всё, что нужно flow целиком: плагин включается или
 * выключается только в начале сессии, поэтому решается на весь flow сразу. Плагин выключается, когда всё, что он
 * даёт, — под включёнными переключателями и ничего из этого flow не нужно; плагин без навыков, команд и агентов —
 * только с MCP или хуками — не трогается. `accountSkills` — навыки аккаунта claude.ai, которых нет в каталоге bb.
 */
export const hiddenOf = ({
  catalog,
  plugins,
  limits,
  opened,
  needed,
  accountSkills = [],
}: {
  catalog: StageCatalog;
  plugins: readonly ClaudePlugin[];
  limits: Limits;
  opened: Scope;
  needed: Scope;
  accountSkills?: readonly string[];
}): Hidden => {
  const agents = claudeAgents(catalog);
  const offPlugin = (plugin: ClaudePlugin): boolean => {
    const skills = distinct([...catalog.skills.filter((skill) => pluginOfSkill(skill) === plugin.name).map((skill) => skill.name), ...(plugin.skills ?? [])]);
    const types = agents.filter((agent) => agent.plugin === plugin.name).map((agent) => agent.type);
    const limited = (skills.length === 0 || limits.skills) && (types.length === 0 || limits.agents);
    const used = skills.some((name) => needed.skills.includes(name)) || types.some((type) => needed.agents.includes(type));
    return skills.length + types.length > 0 && limited && !used;
  };
  const off = plugins.filter(offPlugin);
  // Агенты выключенного плагина уходят вместе с ним; агенты включённого прячутся по одному, как свои.
  const shown = agents.filter((agent) => !off.some((plugin) => plugin.name === agent.plugin)).map((agent) => agent.type);
  const ownSkills = [...catalog.skills.filter(isOwnSkill).map((skill) => skill.name), ...accountSkills, ...workflowNames(catalog)];
  return {
    skills: limits.skills ? outside(ownSkills, [...opened.skills, ...(opened.workflows ?? [])]) : [],
    agents: limits.agents ? outside([...BUILTIN_AGENTS, ...shown], opened.agents) : [],
    plugins: off.map((plugin) => plugin.key),
    bundled: limits.skills,
  };
};

type Json = Record<string, unknown>;

const record = (value: unknown): Json => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {});
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
const denyRule = (type: string): string => `Agent(${type})`;
/** Ключ Claude Code, который убирает встроенные навыки и workflow разом. */
const BUNDLED_KEY = "disableBundledSkills";

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
    ...(wanted.bundled === undefined ? {} : { bundled: wanted.bundled && !(BUNDLED_KEY in current && previous.bundled !== true) }),
  };
};

/** Ключ встроенных навыков: Flow ставит свой, снимает только свой. */
const withBundled = (json: Json, previous: boolean, next: boolean): Json => {
  if (next) return { ...json, [BUNDLED_KEY]: true };
  const { [BUNDLED_KEY]: _, ...rest } = json;
  return previous ? rest : json;
};

/** Новый JSON .claude/settings.local.json: записи прошлой записи Flow сняты, новые положены, ключи владельца не тронуты. */
export const mergeLocalSettings = (current: Json, previous: Hidden, next: Hidden): Json =>
  [
    (json: Json) => withSection(json, "skillOverrides", overridesOf(json.skillOverrides, previous.skills, next.skills)),
    (json: Json) => withSection(json, "permissions", permissionsOf(json.permissions, previous.agents, next.agents)),
    (json: Json) => withSection(json, "enabledPlugins", pluginsOf(json.enabledPlugins, previous.plugins, next.plugins)),
    (json: Json) => withBundled(json, previous.bundled === true, next.bundled === true),
  ].reduce((json, step) => step(json), current);
