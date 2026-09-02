// Layer 3 — assembling what the panel sees from already-parsed documents.
// Pure code with no I/O: server.ts reads the files and hands over ready
// documents and path lists, and gets back state rows for each section.
//
// Depends only downward: settings-doc, effective, catalog — layers 1 and 2.

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
  collectAgentNames,
  collectSkillNames,
  mergeAgents,
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
  /** Toggle state in this scope — the effective on/off. */
  value: boolean;
  /**
   * Project scope only: the effective value matches the global one, i.e.
   * the row isn't overridden. The UI dims such rows. Nothing to compare
   * against in the global scope — always false there.
   */
  dimmed: boolean;
  /** Plugin's install directory: present — the row is clickable, opens the README. */
  installPath: string | null;
}

/** Enabled skill mode — the same `skillOverrides` values, minus `off`. */
export type SkillMode = "on" | "name-only" | "user-invocable-only";

export interface SkillRow {
  name: string;
  origin: "personal" | "project";
  /** Effective toggle: the skill isn't disabled. */
  enabled: boolean;
  /** Mode while the skill is enabled (default for display when disabled). */
  mode: SkillMode;
  /** Project scope: the effective state matches the global one. */
  dimmed: boolean;
}

export interface AgentRow {
  name: string;
  origin: "personal" | "project";
  /** Absolute path to the agent file — the panel opens it by this path. */
  path: string;
}

/** Mode while tool loading is enabled: "Always" (on) or "Automatic" (auto). */
export type ToolSearchModeOn = "on" | "auto";

export interface ToolSearchRow {
  /** Toggle: loading isn't disabled. */
  enabled: boolean;
  /** Mode while loading is enabled (default for display when disabled). */
  mode: ToolSearchModeOn;
  /** Project scope: the effective state matches the global one. */
  dimmed: boolean;
}

/** Where a connector is declared: project .mcp.json, user or local scope. */
export type ConnectorOrigin = "mcpjson" | "user" | "local";

export interface ConnectorRow {
  name: string;
  origin: ConnectorOrigin;
  /** Transport for the label (stdio/http/...). */
  transport: string;
  /** Whether the row can be toggled — only for .mcp.json servers. */
  toggleable: boolean;
  /** Effective on/off (for .mcp.json); always true (active) for read-only. */
  value: boolean;
  /** Project scope: effective value matches global (only for .mcp.json). */
  dimmed: boolean;
}

/** Level the hook came from: user, project, local. */
export type HookOrigin = "user" | "project" | "local";

export interface HookRow {
  event: string;
  matcher: string | null;
  command: string;
  origin: HookOrigin;
  /** Position within its level's hook list — the address for reading the command. */
  index: number;
  /** Whether the hook is active: false — cut out of the file, sitting in the disabled list. */
  enabled: boolean;
}

export interface ConfigView {
  plugins: PluginRow[];
  connectors: ConnectorRow[];
  skills: SkillRow[];
  agents: AgentRow[];
  hooks: HookRow[];
  toolSearch: ToolSearchRow;
}

/**
 * Input is already-parsed documents, not text: server.ts does the
 * file-tied parsing (and parse-error reporting) earlier, so the UI can
 * say which exact file is broken. Only valid documents reach here.
 */
export interface ViewInput {
  /** Global scope or project scope — determines whether rows get dimmed. */
  areaKind: "global" | "project";
  /** The file the panel edits: its own value comes from here. */
  editedDoc: doc.SettingsDoc;
  /** Levels from broad to narrow, for resolving to the effective value. */
  levelDocs: doc.SettingsDoc[];
  /** Text of `installed_plugins.json` as returned by the host (or null). */
  installedPluginsText: string | null;
  /** Paths inside the personal skills directory (`~/.claude/skills`). */
  personalSkillPaths: string[];
  /** Paths inside the project skills directory (empty for the global scope). */
  projectSkillPaths: string[];
  /** Absolute personal agents directory (`~/.claude/agents`) — for row paths. */
  personalAgentDir: string;
  /** Absolute project agents directory (null for the global scope). */
  projectAgentDir: string | null;
  /** File names inside the personal agents directory. */
  personalAgentPaths: string[];
  /** File names inside the project agents directory (empty globally). */
  projectAgentPaths: string[];
  /** Text of the project `.mcp.json` (null in the global scope or if the file is absent). */
  mcpJsonText: string | null;
  /** Text of `~/.claude.json` — the source of user and local servers. */
  claudeJsonText: string | null;
  /** Project root — the local-scope key in `~/.claude.json` (null globally). */
  projectRoot: string | null;
  /** Origin of each level in levelDocs — for the hook label. */
  levelOrigins: HookOrigin[];
  /**
   * Disabled hooks by level (same length and order as levelDocs).
   * Disabling isn't a value in the JSON document but separate storage: the
   * hook is cut out of the file and lives here until it's re-enabled.
   */
  disabledHooksByLevel: HookEntry[][];
}

export function buildConfigView(input: ViewInput): ConfigView {
  return {
    plugins: buildPlugins(input),
    connectors: buildConnectors(input),
    skills: buildSkills(input),
    agents: buildAgents(input),
    hooks: buildHooks(input),
    toolSearch: buildToolSearch(input),
  };
}

function buildAgents(input: ViewInput): AgentRow[] {
  const personal = collectAgentNames(input.personalAgentPaths);
  const project = collectAgentNames(input.projectAgentPaths);
  return mergeAgents(personal, project).map((entry) => {
    const dir =
      entry.origin === "project" ? input.projectAgentDir : input.personalAgentDir;
    return {
      name: entry.name,
      origin: entry.origin,
      // The project-scope dir is non-empty since the name came from projectAgentPaths.
      path: `${dir ?? input.personalAgentDir}/${entry.name}.md`,
    };
  });
}

function buildConnectors(input: ViewInput): ConnectorRow[] {
  const rows: ConnectorRow[] = [];
  const globalDoc = input.levelDocs[0] ?? {};

  // Servers from the project .mcp.json — with a toggle. The effective value
  // is resolved from the enabled/disabled arrays of all levels, with the
  // default coming from enableAll.
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

  // Servers from ~/.claude.json — read-only: settings.json doesn't gate them.
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
    // Mode when loading is disabled doesn't matter — show the "Auto" default.
    mode: effective === "off" ? "auto" : effective,
    dimmed: input.areaKind === "project" && effective === globalState,
  };
}

function buildPlugins(input: ViewInput): PluginRow[] {
  const installed = parseInstalledPlugins(input.installedPluginsText);
  const byKey = new Map<string, InstalledPlugin>();
  for (const plugin of installed) byKey.set(plugin.key, plugin);

  // The key might be disabled in settings but already removed from the
  // installed list — still show it so the toggle can be reverted.
  const keys = new Set(byKey.keys());
  for (const level of input.levelDocs) {
    for (const key of doc.listPluginKeys(level)) keys.add(key);
  }
  for (const key of doc.listPluginKeys(input.editedDoc)) keys.add(key);

  // The global value is resolved from just the broad level (`~/.claude`),
  // which is the first of levelDocs in both scopes. We compare against it in the project.
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

  // The skill might have been deleted from disk while its skillOverrides
  // entry remains — show it as personal so the override can be removed.
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
      // Mode when the skill is disabled doesn't matter — show the "full" default.
      mode: effective === "off" ? "on" : effective,
      dimmed: input.areaKind === "project" && effective === globalState,
    };
  });
}

/** Synthesizes metadata for a key that isn't among the installed ones. */
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
