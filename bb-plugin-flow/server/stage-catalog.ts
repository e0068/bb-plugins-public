// Каталог секции этапов: навыки bb по всем проектам с их источником, агенты — свои из ~/.claude/agents с подпапками,
// из .claude/agents проектов bb, из установленных плагинов Claude Code и из ~/.codex/agents, — и сохранённые
// workflow владельца, а отдельно — где лежит файл навыка по имени.
// Источник, который не ответил, даёт пустую
// часть каталога — секция настроек остаётся рабочей и без подсказок.
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { installedPluginDirs, parseAgentFile, parseCodexAgentFile, parseWorkflowFile, skillOrigin } from "../core/catalog";
import type { ExecutorOrigin, SkillFile, SkillOrigin, StageCatalog, StageExecutor } from "../shared/contract";

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

const readExecutors = async (sources: CatalogSources, paths: readonly string[], parse: (text: string) => StageExecutor | null): Promise<StageExecutor[]> => {
  const parsed = await Promise.all(paths.map((path) => settled(async () => parse(await sources.readFile(path)), null)));
  return parsed.filter((e): e is StageExecutor => e !== null);
};

const withOrigin = (origin: ExecutorOrigin) => (executor: StageExecutor): StageExecutor => ({ ...executor, origin });

const readAgentTree = async (sources: CatalogSources, dir: string, origin: ExecutorOrigin): Promise<StageExecutor[]> =>
  (await readExecutors(sources, await listFiles(sources, dir, ".md", AGENT_DEPTH), parseAgentFile)).map(withOrigin(origin));

const readProjectAgents = async (sources: CatalogSources): Promise<StageExecutor[]> => {
  const projects = await settled(async () => (await sources.projects?.()) ?? [], []);
  const lists = await Promise.all(projects.map(({ name, path }) => readAgentTree(sources, join(path, ".claude", "agents"), { kind: "project", project: name })));
  return lists.flat();
};

/** Агенты включённых плагинов Claude Code — с префиксом плагина, как их зовёт сам Claude Code. */
const readPluginAgents = async (sources: CatalogSources): Promise<StageExecutor[]> => {
  const claude = join(sources.home, ".claude");
  const [installed, settings] = await Promise.all([
    settled(() => sources.readFile(join(claude, "plugins", "installed_plugins.json")), ""),
    settled<string | null>(() => sources.readFile(join(claude, "settings.json")), null),
  ]);
  const lists = await Promise.all(
    installedPluginDirs(installed, settings).map(async ({ plugin, dir }) =>
      (await readAgentTree(sources, join(dir, "agents"), { kind: "plugin", plugin })).map((agent) => ({ ...agent, id: `agent:${plugin}:${agent.name}`, name: `${plugin}:${agent.name}` })),
    ),
  );
  return lists.flat();
};

/** Исполнитель с тем же id — один, первый по порядку источников: свои, проекты, плагины. */
const distinct = (executors: readonly StageExecutor[]): StageExecutor[] =>
  executors.reduce<StageExecutor[]>((acc, executor) => (acc.some((seen) => seen.id === executor.id) ? acc : [...acc, executor]), []);

export const readStageCatalog = async (sources: CatalogSources): Promise<StageCatalog> => {
  const [skills, own, projects, plugins, codex, workflows] = await Promise.all([
    readSkills(sources),
    readAgentTree(sources, join(sources.home, ".claude", "agents"), { kind: "own" }),
    readProjectAgents(sources),
    readPluginAgents(sources),
    listFiles(sources, join(sources.home, ".codex", "agents"), ".toml", 0).then((paths) => readExecutors(sources, paths, parseCodexAgentFile)),
    listFiles(sources, join(sources.home, ".claude", "workflows"), ".js", 0).then((paths) => readExecutors(sources, paths, parseWorkflowFile)),
  ]);
  return { skills, executors: distinct([...own, ...projects, ...plugins, ...codex, ...workflows]) };
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
