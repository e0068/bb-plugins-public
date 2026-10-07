// Каталог секции этапов: навыки bb по всем проектам с их источником, агенты — свои из ~/.claude/agents с подпапками,
// из .claude/agents проектов bb, из установленных плагинов Claude Code и из ~/.codex/agents, — и сохранённые
// workflow владельца, а отдельно — где лежит файл навыка по имени.
// Источник, который не ответил, даёт пустую
// часть каталога — секция настроек остаётся рабочей и без подсказок.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { installedPlugins, parseAgentFile, parseCodexAgentFile, parseWorkflowFile, skillOrigin } from "../core/catalog";
import type { ClaudePlugin } from "../core/skill-scope";
import type { AutomationScript, ExecutorOrigin, SkillFile, SkillOrigin, StageCatalog, StageExecutor } from "../shared/contract";

export type CatalogSources = {
  projectIds: () => Promise<string[]>;
  skills: (projectId: string) => Promise<ReadonlyArray<{ name: string; description: string | null; scope?: string; pluginId?: string | null; provider?: string | null }>>;
  listDir: (dir: string) => Promise<string[]>;
  readFile: (path: string) => Promise<string>;
  home: string;
  /** Проекты bb и их папка по умолчанию — там лежат `.claude/agents` проекта; нет источника — агентов проектов нет. */
  projects?: () => Promise<ReadonlyArray<{ name: string; path: string }>>;
};

const settled = async <T>(work: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await work();
  } catch {
    return fallback;
  }
};

const readSkills = async (sources: CatalogSources): Promise<StageCatalog["skills"]> => {
  const ids = await settled(sources.projectIds, []);
  const lists = await Promise.all(ids.map((id) => settled(() => sources.skills(id), [])));
  // Одноимённый навык нескольких проектов — один: источник первого, описание первого, у кого оно есть.
  const byName = lists.flat().reduce((acc, skill) => {
    const seen = acc.get(skill.name);
    return acc.set(skill.name, { origin: seen?.origin ?? skillOrigin(skill), description: seen?.description ?? skill.description ?? undefined });
  }, new Map<string, { origin: SkillOrigin; description: string | undefined }>());
  return [...byName.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, { origin, description }]) => (description === undefined ? { name, origin } : { name, description, origin }));
};

/** Глубина подпапок, в которых ищутся агенты. */
const AGENT_DEPTH = 3;

/** Пути файлов с окончанием в папке и в её подпапках — записях без точки в имени. */
const listFiles = async (sources: CatalogSources, dir: string, suffix: string, depth: number): Promise<string[]> => {
  const entries = await settled(() => sources.listDir(dir), []);
  const nested = depth === 0 ? [] : await Promise.all(entries.filter((entry) => !entry.includes(".")).map((entry) => listFiles(sources, join(dir, entry), suffix, depth - 1)));
  return [...entries.filter((entry) => entry.endsWith(suffix)).sort().map((entry) => join(dir, entry)), ...nested.flat()];
};

/** Исполнитель каталога и файл, из которого он прочитан: каталог отдаёт исполнителя, чип открывает файл. */
type ExecutorEntry = { executor: StageExecutor; path: string };

const readExecutors = async (sources: CatalogSources, paths: readonly string[], parse: (text: string) => StageExecutor | null): Promise<ExecutorEntry[]> => {
  const parsed = await Promise.all(paths.map((path) => settled(async () => parse(await sources.readFile(path)), null)));
  return parsed.flatMap((executor, i) => (executor === null ? [] : [{ executor, path: paths[i]! }]));
};

const withOrigin = (origin: ExecutorOrigin) => (entry: ExecutorEntry): ExecutorEntry => ({ ...entry, executor: { ...entry.executor, origin } });

const readAgentTree = async (sources: CatalogSources, dir: string, origin: ExecutorOrigin): Promise<ExecutorEntry[]> =>
  (await readExecutors(sources, await listFiles(sources, dir, ".md", AGENT_DEPTH), parseAgentFile)).map(withOrigin(origin));

const readProjectAgents = async (sources: CatalogSources): Promise<ExecutorEntry[]> => {
  const projects = await settled(async () => (await sources.projects?.()) ?? [], []);
  const lists = await Promise.all(projects.map(({ name, path }) => readAgentTree(sources, join(path, ".claude", "agents"), { kind: "project", project: name })));
  return lists.flat();
};

/** Агенты включённых плагинов Claude Code — с префиксом плагина, как их зовёт сам Claude Code. */
/** Включённые плагины Claude Code из installed_plugins.json и enabledPlugins настроек. */
const readInstalledPlugins = async (sources: CatalogSources): Promise<Array<{ key: string; plugin: string; dir: string }>> => {
  const claude = join(sources.home, ".claude");
  const [installed, settings] = await Promise.all([
    settled(() => sources.readFile(join(claude, "plugins", "installed_plugins.json")), ""),
    settled<string | null>(() => sources.readFile(join(claude, "settings.json")), null),
  ]);
  return installedPlugins(installed, settings);
};

const readPluginAgents = async (sources: CatalogSources): Promise<ExecutorEntry[]> => {
  const lists = await Promise.all(
    (await readInstalledPlugins(sources)).map(async ({ plugin, dir }) =>
      (await readAgentTree(sources, join(dir, "agents"), { kind: "plugin", plugin })).map(({ executor, path }) => ({
        executor: { ...executor, id: `agent:${plugin}:${executor.name}`, name: `${plugin}:${executor.name}` },
        path,
      })),
    ),
  );
  return lists.flat();
};

/** Исполнитель с тем же id — один, первый по порядку источников: свои, проекты, плагины. */
const distinct = (entries: readonly ExecutorEntry[]): ExecutorEntry[] =>
  entries.reduce<ExecutorEntry[]>((acc, entry) => (acc.some((seen) => seen.executor.id === entry.executor.id) ? acc : [...acc, entry]), []);

const readExecutorEntries = async (sources: CatalogSources): Promise<ExecutorEntry[]> => {
  const lists = await Promise.all([
    readAgentTree(sources, join(sources.home, ".claude", "agents"), { kind: "own" }),
    readProjectAgents(sources),
    readPluginAgents(sources),
    listFiles(sources, join(sources.home, ".codex", "agents"), ".toml", 0).then((paths) => readExecutors(sources, paths, parseCodexAgentFile)),
    listFiles(sources, join(sources.home, ".claude", "workflows"), ".js", 0).then((paths) => readExecutors(sources, paths, parseWorkflowFile)),
  ]);
  return distinct(lists.flat());
};

export const readStageCatalog = async (sources: CatalogSources): Promise<StageCatalog> => {
  const [skills, entries] = await Promise.all([readSkills(sources), readExecutorEntries(sources)]);
  return { skills, executors: entries.map((entry) => entry.executor) };
};

/** Включённые плагины Claude Code с ключом `enabledPlugins`: по ним Flow выключает в дереве треда ненужные flow. */
export const readClaudePlugins = async (sources: CatalogSources): Promise<ClaudePlugin[]> =>
  (await readInstalledPlugins(sources)).map(({ key, plugin }) => ({ key, name: plugin }));

/** Тексты скриптов workflow каталога по id исполнителя; непрочитанный скрипт пропускается. */
export const readWorkflowScripts = async (sources: CatalogSources): Promise<Array<{ id: string; text: string }>> => {
  const workflows = (await readExecutorEntries(sources)).filter((entry) => entry.executor.kind === "workflow");
  const texts = await Promise.all(workflows.map((entry) => settled<string | null>(() => sources.readFile(entry.path), null)));
  return workflows.flatMap((entry, i) => (texts[i] == null ? [] : [{ id: entry.executor.id, text: texts[i]! }]));
};

export type ExecutorFileSources = CatalogSources & { primaryHostId: () => Promise<string | null> };

/** Имя без разделителей пути: id и имя скрипта приходят от страницы и не должны вывести файл из своей папки; «.» и «..» — тоже путь. */
const safeName = (name: string): string => {
  const safe = basename(name).replace(/[^\w.-]/g, "_");
  return /^\.*$/.test(safe) ? "script" : safe;
};

/** Текст в блоке кода markdown с языком по расширению имени; ограда длиннее любой серии обратных кавычек текста. */
const codeBlock = (name: string, content: string): string => {
  const fence = "`".repeat(Math.max(3, ...(content.match(/`+/g) ?? []).map((run) => run.length + 1)));
  return `${fence}${extname(name).slice(1)}\n${content}${content.endsWith("\n") ? "" : "\n"}${fence}\n`;
};

/**
 * Снимок текста для правой панели — markdown во временной папке сервера, только для чтения: правка снимка источник
 * не меняет. Его открывает bb-plugin-md-opener: файл кода bb открыл бы своим monaco-editor, а тот не читает файл
 * хоста без окружения, и панель осталась бы пустой.
 */
const writeSnapshot = async (key: string, name: string, content: string): Promise<string> => {
  const safe = safeName(name);
  const dir = join(tmpdir(), "bb-flow-scripts", safeName(key));
  const path = join(dir, `${safe}.md`);
  await mkdir(dir, { recursive: true });
  await writeFile(path, codeBlock(safe, content), "utf8");
  return path;
};

/** Свой скрипт живёт текстом в настройках flow, файла у него нет — правая панель получает его снимком. */
export const writeScriptFile = async (script: Pick<AutomationScript, "id" | "name" | "content">, primaryHostId: () => Promise<string | null>): Promise<SkillFile> => {
  const hostId = await settled(primaryHostId, null);
  return hostId === null ? null : { hostId, path: await writeSnapshot(script.id, script.name, script.content) };
};

/** Файл агента или workflow по id исполнителя и хост сервера: markdown — сам файл, остальное — снимок; исполнитель не нашёлся, файл не прочитался или хоста нет — `null`. */
export const readExecutorFile = async (sources: ExecutorFileSources, id: string): Promise<SkillFile> => {
  const [entries, hostId] = await Promise.all([readExecutorEntries(sources), settled(sources.primaryHostId, null)]);
  const found = entries.find((entry) => entry.executor.id === id);
  if (hostId === null || found === undefined) return null;
  if (extname(found.path) === ".md") return { hostId, path: found.path };
  return settled(async () => ({ hostId, path: await writeSnapshot(id, basename(found.path), await sources.readFile(found.path)) }), null);
};

export type SkillFileSources = {
  projectIds: () => Promise<string[]>;
  skills: (projectId: string) => Promise<ReadonlyArray<{ name: string; filePath: string; pluginId: string | null }>>;
  primaryHostId: () => Promise<string | null>;
};

/** Файл навыка по имени и хост сервера: навык владельца важнее одноимённого навыка плагина; не нашёлся или источник упал — `null`. */
export const readSkillFile = async (sources: SkillFileSources, name: string): Promise<SkillFile> => {
  const ids = await settled(sources.projectIds, []);
  const [lists, hostId] = await Promise.all([Promise.all(ids.map((id) => settled(() => sources.skills(id), []))), settled(sources.primaryHostId, null)]);
  const named = lists.flat().filter((skill) => skill.name === name);
  const found = named.find((skill) => skill.pluginId === null) ?? named[0];
  return hostId === null || found === undefined ? null : { hostId, path: found.filePath };
};

/** Источники файла навыка на живом сервере. */
export const hostSkillFileSources = (bb: Pick<BbPluginApi, "sdk">): SkillFileSources => ({
  projectIds: async () => (await bb.sdk.projects.list()).map((p) => p.id),
  skills: async (projectId) => (await bb.sdk.skills.list({ projectId, environmentId: null })).skills,
  primaryHostId: async () => (await bb.sdk.system.config()).primaryHostId,
});

/** Источники каталога на живом сервере. */
export const hostCatalogSources = (bb: Pick<BbPluginApi, "sdk">): CatalogSources => ({
  projectIds: async () => (await bb.sdk.projects.list()).map((p) => p.id),
  skills: async (projectId) => (await bb.sdk.skills.list({ projectId, environmentId: null })).skills,
  listDir: (dir) => readdir(dir),
  readFile: (path) => readFile(path, "utf8"),
  home: homedir(),
  projects: async () =>
    (await bb.sdk.projects.list()).flatMap((project) => {
      const source = project.sources.find((s) => s.isDefault) ?? project.sources[0];
      return source === undefined ? [] : [{ name: project.name, path: source.path }];
    }),
});
