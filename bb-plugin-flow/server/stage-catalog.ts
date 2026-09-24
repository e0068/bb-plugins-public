// Каталог секции этапов: навыки bb по всем проектам, агенты Claude Code и
// сохранённые workflow владельца, а отдельно — где лежат корневой навык flow и
// файл навыка по имени.
// Источник, который не ответил, даёт пустую
// часть каталога — секция настроек остаётся рабочей и без подсказок.
import { access, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { parseAgentFile, parseWorkflowFile } from "../core/catalog";
import { rootSkillPath } from "./root-skill-writer";
import type { RootSkill, StageCatalog, StageExecutor } from "../shared/contract";

export type CatalogSources = {
  projectIds: () => Promise<string[]>;
  skills: (projectId: string) => Promise<ReadonlyArray<{ name: string; description: string | null }>>;
  listDir: (dir: string) => Promise<string[]>;
  readFile: (path: string) => Promise<string>;
  home: string;
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
  const byName = new Map<string, string | undefined>();
  for (const skill of lists.flat()) byName.set(skill.name, byName.get(skill.name) ?? skill.description ?? undefined);
  return [...byName.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, description]) => (description === undefined ? { name } : { name, description }));
};

const readExecutors = async (sources: CatalogSources, dir: string, suffix: string, parse: (text: string) => StageExecutor | null): Promise<StageExecutor[]> => {
  const files = (await settled(() => sources.listDir(dir), [])).filter((file) => file.endsWith(suffix)).sort();
  const parsed = await Promise.all(files.map((file) => settled(async () => parse(await sources.readFile(join(dir, file))), null)));
  return parsed.filter((e): e is StageExecutor => e !== null);
};

export const readStageCatalog = async (sources: CatalogSources): Promise<StageCatalog> => {
  const [skills, agents, workflows] = await Promise.all([
    readSkills(sources),
    readExecutors(sources, join(sources.home, ".claude", "agents"), ".md", parseAgentFile),
    readExecutors(sources, join(sources.home, ".claude", "workflows"), ".js", parseWorkflowFile),
  ]);
  return { skills, executors: [...agents, ...workflows] };
};

export type RootSkillSources = {
  home: string;
  primaryHostId: () => Promise<string | null>;
  exists: (path: string) => Promise<boolean>;
};

/** Корневой навык flow в `~/.claude/skills`: путь и хост сервера, чтобы страница открыла файл; нет файла, хоста или источник упал — `null`. */
export const readRootSkill = async (sources: RootSkillSources): Promise<RootSkill> => {
  const path = rootSkillPath(sources.home);
  const [hostId, exists] = await Promise.all([settled(sources.primaryHostId, null), settled(() => sources.exists(path), false)]);
  return hostId === null || !exists ? null : { hostId, path };
};

export type SkillFileSources = {
  projectIds: () => Promise<string[]>;
  skills: (projectId: string) => Promise<ReadonlyArray<{ name: string; filePath: string; pluginId: string | null }>>;
  primaryHostId: () => Promise<string | null>;
};

/** Файл навыка по имени и хост сервера: навык владельца важнее одноимённого навыка плагина; не нашёлся или источник упал — `null`. */
export const readSkillFile = async (sources: SkillFileSources, name: string): Promise<RootSkill> => {
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

/** Источники корневого навыка на живом сервере. */
export const hostRootSkillSources = (bb: Pick<BbPluginApi, "sdk">): RootSkillSources => ({
  home: homedir(),
  primaryHostId: async () => (await bb.sdk.system.config()).primaryHostId,
  exists: (path) => access(path).then(() => true),
});

/** Источники каталога на живом сервере. */
export const hostCatalogSources = (bb: Pick<BbPluginApi, "sdk">): CatalogSources => ({
  projectIds: async () => (await bb.sdk.projects.list()).map((p) => p.id),
  skills: async (projectId) => (await bb.sdk.skills.list({ projectId, environmentId: null })).skills,
  listDir: (dir) => readdir(dir),
  readFile: (path) => readFile(path, "utf8"),
  home: homedir(),
});
