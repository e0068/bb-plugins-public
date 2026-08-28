// Слой 3 — сборка того, что видит панель, из уже разобранных документов.
// Чистый код без ввода-вывода: server.ts читает файлы и передаёт сюда готовые
// документы и списки путей, а получает строки-состояния для каждой секции.
//
// Зависит только вниз: settings-doc, effective, catalog — слои 1 и 2.

import * as doc from "./settings-doc";
import type { HookEntry } from "./settings-doc";
import {
  resolveEnableAllMcp,
  resolveMcpServer,
  resolvePlugin,
  resolveSkill,
  resolveToolSearch,
} from "./effective";
import {
  collectSkillNames,
  mergeSkills,
  parseClaudeJsonServers,
  parseInstalledPlugins,
  parseMcpJson,
  type InstalledPlugin,
} from "./catalog";

export interface PluginRow {
  key: string;
  name: string;
  marketplace: string;
  version: string | null;
  /** Состояние свитча в этой области — действующее вкл/выкл. */
  value: boolean;
  /**
   * Только для проектной области: действующее значение совпадает с глобальным,
   * то есть строка не переопределена. UI гасит такие строки. В глобальной
   * области сравнивать не с чем — здесь всегда false.
   */
  dimmed: boolean;
  /** Каталог плагина: есть — строка кликабельна, открывает README. */
  installPath: string | null;
}

/** Режим включённого навыка — те же значения `skillOverrides`, кроме `off`. */
export type SkillMode = "on" | "name-only" | "user-invocable-only";

export interface SkillRow {
  name: string;
  origin: "personal" | "project";
  /** Действующий тоггл: навык не выключен. */
  enabled: boolean;
  /** Режим при включённом навыке (при выключенном — дефолт для показа). */
  mode: SkillMode;
  /** Проектная область: действующее состояние совпало с глобальным. */
  dimmed: boolean;
}

/** Режим включённой подгрузки: «Всегда» (on) или «Автоматически» (auto). */
export type ToolSearchModeOn = "on" | "auto";

export interface ToolSearchRow {
  /** Тоггл: подгрузка не выключена. */
  enabled: boolean;
  /** Режим при включённой подгрузке (при выключенной — дефолт для показа). */
  mode: ToolSearchModeOn;
  /** Проектная область: действующее состояние совпало с глобальным. */
  dimmed: boolean;
}

/** Откуда объявлен коннектор: проектный .mcp.json, user- или local-скоуп. */
export type ConnectorOrigin = "mcpjson" | "user" | "local";

export interface ConnectorRow {
  name: string;
  origin: ConnectorOrigin;
  /** Транспорт для подписи (stdio/http/…). */
  transport: string;
  /** Строку можно переключать — только для серверов .mcp.json. */
  toggleable: boolean;
  /** Действующее вкл/выкл (для .mcp.json); для read-only всегда true (активен). */
  value: boolean;
  /** Проектная область: действующее совпало с глобальным (только .mcp.json). */
  dimmed: boolean;
}

/** Уровень, с которого пришёл хук: пользовательский, проектный, локальный. */
export type HookOrigin = "user" | "project" | "local";

export interface HookRow {
  event: string;
  matcher: string | null;
  command: string;
  origin: HookOrigin;
  /** Позиция в списке хуков своего уровня — адрес для чтения команды. */
  index: number;
  /** Активен ли хук: false — хук вырезан из файла и лежит в disabled-списке. */
  enabled: boolean;
}

export interface ConfigView {
  plugins: PluginRow[];
  connectors: ConnectorRow[];
  skills: SkillRow[];
  hooks: HookRow[];
  toolSearch: ToolSearchRow;
}

/**
 * На входе — уже разобранные документы, не текст: разбор с привязкой к файлу
 * (и ошибку разбора) server.ts делает раньше, чтобы сказать в UI, какой именно
 * файл битый. Сюда доходят только валидные документы.
 */
export interface ViewInput {
  /** Глобальная область или проектная — от этого зависит гашение строк. */
  areaKind: "global" | "project";
  /** Файл, который правит панель: своё значение берётся отсюда. */
  editedDoc: doc.SettingsDoc;
  /** Уровни от широкого к узкому для свёртки в действующее значение. */
  levelDocs: doc.SettingsDoc[];
  /** Текст `installed_plugins.json`, как его вернул хост (или null). */
  installedPluginsText: string | null;
  /** Пути внутри личного каталога навыков (`~/.claude/skills`). */
  personalSkillPaths: string[];
  /** Пути внутри проектного каталога навыков (пусто для глобальной области). */
  projectSkillPaths: string[];
  /** Текст проектного `.mcp.json` (null в глобальной области или если файла нет). */
  mcpJsonText: string | null;
  /** Текст `~/.claude.json` — оттуда user- и local-серверы. */
  claudeJsonText: string | null;
  /** Корень проекта — ключ local-скоупа в `~/.claude.json` (null глобально). */
  projectRoot: string | null;
  /** Происхождение каждого уровня из levelDocs — для подписи хуков. */
  levelOrigins: HookOrigin[];
  /**
   * Выключенные хуки по уровням (та же длина и порядок, что levelDocs).
   * Выключение — не значение в JSON-документе, а отдельное хранение: хук
   * вырезается из файла и живёт здесь, пока его не включат обратно.
   */
  disabledHooksByLevel: HookEntry[][];
}

export function buildConfigView(input: ViewInput): ConfigView {
  return {
    plugins: buildPlugins(input),
    connectors: buildConnectors(input),
    skills: buildSkills(input),
    hooks: buildHooks(input),
    toolSearch: buildToolSearch(input),
  };
}

function buildConnectors(input: ViewInput): ConnectorRow[] {
  const rows: ConnectorRow[] = [];
  const globalDoc = input.levelDocs[0] ?? {};

  // Серверы проектного .mcp.json — с тумблером. Действующее значение считаем по
  // enabled/disabled массивам всех уровней с умолчанием от enableAll.
  for (const def of parseMcpJson(input.mcpJsonText)) {
    const states = input.levelDocs.map((level) => doc.getMcpServer(level, def.name));
    const enableAll = resolveEnableAllMcp(
      input.levelDocs.map((level) => doc.getEnableAllMcp(level)),
    );
    const value = resolveMcpServer(states, enableAll) === "on";

    const globalValue =
      resolveMcpServer(
        [doc.getMcpServer(globalDoc, def.name)],
        resolveEnableAllMcp([doc.getEnableAllMcp(globalDoc)]),
      ) === "on";

    rows.push({
      name: def.name,
      origin: "mcpjson",
      transport: def.transport,
      toggleable: true,
      value,
      dimmed: input.areaKind === "project" && value === globalValue,
    });
  }

  // Серверы из ~/.claude.json — read-only: settings.json их не гейтит.
  const { user, local } = parseClaudeJsonServers(
    input.claudeJsonText,
    input.projectRoot,
  );
  for (const def of user) {
    rows.push(readonlyConnector(def.name, "user", def.transport));
  }
  for (const def of local) {
    rows.push(readonlyConnector(def.name, "local", def.transport));
  }

  return rows.sort(
    (a, b) => a.name.localeCompare(b.name) || a.origin.localeCompare(b.origin),
  );
}

function readonlyConnector(
  name: string,
  origin: ConnectorOrigin,
  transport: string,
): ConnectorRow {
  return { name, origin, transport, toggleable: false, value: true, dimmed: false };
}

function buildHooks(input: ViewInput): HookRow[] {
  const rows: HookRow[] = [];
  input.levelDocs.forEach((level, levelIndex) => {
    const origin = input.levelOrigins[levelIndex] ?? "user";
    doc.listHooks(level).forEach((hook, index) => {
      rows.push({ ...hook, origin, index, enabled: true });
    });
    const disabled = input.disabledHooksByLevel[levelIndex] ?? [];
    disabled.forEach((hook) => {
      rows.push({ ...hook, origin, index: -1, enabled: false });
    });
  });
  return rows;
}

function buildToolSearch(input: ViewInput): ToolSearchRow {
  const effective = resolveToolSearch(
    input.levelDocs.map((level) => doc.getToolSearch(level)),
  );
  const globalDoc = input.levelDocs[0] ?? {};
  const globalState = resolveToolSearch([doc.getToolSearch(globalDoc)]);
  return {
    enabled: effective !== "off",
    // Режим при выключенной подгрузке не важен — показываем дефолт «Авто».
    mode: effective === "off" ? "auto" : effective,
    dimmed: input.areaKind === "project" && effective === globalState,
  };
}

function buildPlugins(input: ViewInput): PluginRow[] {
  const installed = parseInstalledPlugins(input.installedPluginsText);
  const byKey = new Map<string, InstalledPlugin>();
  for (const plugin of installed) byKey.set(plugin.key, plugin);

  // Ключ мог быть выключен в настройках, но уже удалён из установленных —
  // всё равно показываем, чтобы переключатель можно было вернуть.
  const keys = new Set(byKey.keys());
  for (const level of input.levelDocs) {
    for (const key of doc.listPluginKeys(level)) keys.add(key);
  }
  for (const key of doc.listPluginKeys(input.editedDoc)) keys.add(key);

  // Глобальное значение — свёртка одного лишь широкого уровня (`~/.claude`),
  // это первый из levelDocs в обеих областях. В проекте с ним сравниваем.
  const globalDoc = input.levelDocs[0] ?? {};

  return [...keys]
    .map((key) => {
      const meta = byKey.get(key) ?? pluginFromKey(key);
      const value =
        resolvePlugin(input.levelDocs.map((level) => doc.getPlugin(level, key))) ===
        "on";
      const globalValue = resolvePlugin([doc.getPlugin(globalDoc, key)]) === "on";
      return {
        key,
        name: meta.name,
        marketplace: meta.marketplace,
        version: meta.version,
        value,
        dimmed: input.areaKind === "project" && value === globalValue,
        installPath: meta.installPath,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

function buildSkills(input: ViewInput): SkillRow[] {
  const personal = collectSkillNames(input.personalSkillPaths);
  const project = collectSkillNames(input.projectSkillPaths);
  const entries = mergeSkills(personal, project);
  const known = new Set(entries.map((entry) => entry.name));

  // Навык мог быть удалён с диска, а строка в skillOverrides осталась —
  // показываем её как личную, чтобы override можно было снять.
  const orphans: string[] = [];
  for (const level of [input.editedDoc, ...input.levelDocs]) {
    for (const name of doc.listSkillNames(level)) {
      if (!known.has(name)) {
        known.add(name);
        orphans.push(name);
      }
    }
  }
  const all = [
    ...entries,
    ...orphans.map((name) => ({ name, origin: "personal" as const })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const globalDoc = input.levelDocs[0] ?? {};

  return all.map((entry) => {
    const effective = resolveSkill(
      input.levelDocs.map((level) => doc.getSkill(level, entry.name)),
    );
    const globalState = resolveSkill([doc.getSkill(globalDoc, entry.name)]);
    return {
      name: entry.name,
      origin: entry.origin,
      enabled: effective !== "off",
      // Режим при выключенном навыке не важен — показываем дефолт «полностью».
      mode: effective === "off" ? "on" : effective,
      dimmed: input.areaKind === "project" && effective === globalState,
    };
  });
}

/** Синтезирует метаданные для ключа, которого нет среди установленных. */
function pluginFromKey(key: string): InstalledPlugin {
  const at = key.lastIndexOf("@");
  return {
    key,
    name: at > 0 ? key.slice(0, at) : key,
    marketplace: at > 0 ? key.slice(at + 1) : "",
    version: null,
    installPath: null,
  };
}
