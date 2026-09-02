// Layer 2 — what's actually on the machine: installed plugins and skills.
// Parsing with no I/O: input is file contents and path lists.

export interface InstalledPlugin {
  /** Key in the form `name@marketplace` — the same one used in enabledPlugins. */
  key: string;
  /** Short name without the marketplace — for display. */
  name: string;
  marketplace: string;
  version: string | null;
  /** Plugin install directory — holds the README (plugin reference). */
  installPath: string | null;
}

export interface SkillEntry {
  /** Name the skill is known by in skillOverrides and after the slash. */
  name: string;
  origin: "personal" | "project";
}

export interface McpServerDef {
  /** Server name — the key in the mcpServers object. */
  name: string;
  /** Transport for the label: `stdio`, `http`, `sse`... (or empty if unclear). */
  transport: string;
  /** The server definition as-is — for showing raw JSON in the right-hand tab. */
  config: unknown;
}

/**
 * Parses `~/.claude/plugins/installed_plugins.json` (schema version 2:
 * plugin key → array of per-scope installs).
 *
 * The file belongs to Claude Code, not us, so parsing is lenient: an
 * unfamiliar shape yields an empty list rather than an exception — the
 * panel should still open and show at least what's mentioned in the
 * settings themselves.
 */
export function parseInstalledPlugins(text: string | null): InstalledPlugin[] {
  const root = safeParseObject(text);
  const plugins = root && asObject(root.plugins);
  if (!plugins) return [];

  return Object.entries(plugins).map(([key, installs]) => {
    const first = Array.isArray(installs) ? asObject(installs[0]) : null;
    const version = first && typeof first.version === "string" ? first.version : null;
    const installPath =
      first && typeof first.installPath === "string" ? first.installPath : null;
    const at = key.lastIndexOf("@");
    return {
      key,
      name: at > 0 ? key.slice(0, at) : key,
      marketplace: at > 0 ? key.slice(at + 1) : "",
      version,
      installPath,
    };
  });
}

/**
 * Collects skill names from a list of paths inside the skills directory.
 *
 * A skill is a directory with a `SKILL.md`, so the name comes from the
 * first path segment of such a file. The special `synced/` directory
 * (skills synced from claude.ai) adds a nesting level — its name comes from
 * the second segment.
 */
export function collectSkillNames(relativePaths: string[]): string[] {
  const names = new Set<string>();
  for (const path of relativePaths) {
    const segments = path.split("/").filter(Boolean);
    if (segments[segments.length - 1] !== "SKILL.md") continue;

    const name =
      segments[0] === "synced" && segments.length === 3
        ? segments[1]
        : segments.length === 2
          ? segments[0]
          : null;
    if (name) names.add(name);
  }
  return [...names].sort();
}

/**
 * Collects agent names from a list of paths inside the agents directory.
 *
 * An agent is a single `<name>.md` file directly in the agents directory,
 * so the name comes from the filename without the extension. Nested paths
 * (files in subfolders) don't count as agents and are skipped.
 */
export function collectAgentNames(relativePaths: string[]): string[] {
  const names = new Set<string>();
  for (const path of relativePaths) {
    const segments = path.split("/").filter(Boolean);
    if (segments.length !== 1) continue;
    const file = segments[0];
    if (!file.endsWith(".md")) continue;
    names.add(file.slice(0, -".md".length));
  }
  return [...names].sort();
}

/** Merges the catalogs of two scopes: a project name overrides a personal one. */
export function mergeSkills(
  personal: string[],
  project: string[],
): SkillEntry[] {
  return mergeNamed(personal, project);
}

/** Merges agent name lists of two scopes: project overrides personal. */
export function mergeAgents(
  personal: string[],
  project: string[],
): SkillEntry[] {
  return mergeNamed(personal, project);
}

/** Merge by name: a project entry overrides a personal one, result is sorted. */
function mergeNamed(personal: string[], project: string[]): SkillEntry[] {
  const byName = new Map<string, SkillEntry>();
  for (const name of personal) byName.set(name, { name, origin: "personal" });
  for (const name of project) byName.set(name, { name, origin: "project" });
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Parses servers from the project's `.mcp.json` (shape `{ mcpServers: {...} }`).
 * The file is shared and not ours — parsing is lenient: an unfamiliar shape
 * yields an empty list.
 */
export function parseMcpJson(text: string | null): McpServerDef[] {
  const root = safeParseObject(text);
  return serversFrom(root && root.mcpServers);
}

/**
 * Servers from `~/.claude.json`: top-level `mcpServers` is the user scope;
 * `projects[<root>].mcpServers` is the current project's local scope (empty
 * if the root isn't set or the project isn't in the file).
 */
export function parseClaudeJsonServers(
  text: string | null,
  projectRoot: string | null,
): { user: McpServerDef[]; local: McpServerDef[] } {
  const root = safeParseObject(text);
  const user = serversFrom(root && root.mcpServers);

  let local: McpServerDef[] = [];
  if (root && projectRoot) {
    const projects = asObject(root.projects);
    const project = projects && findProject(projects, projectRoot);
    local = serversFrom(project && project.mcpServers);
  }
  return { user, local };
}

/**
 * Looks up a project by root in `projects` from `~/.claude.json`. First an
 * exact key match, then a match ignoring a trailing `/` on either side: bb
 * and Claude Code can write the path differently. Case and symlinks aren't
 * resolved (would need the filesystem) — rare cases where local servers
 * simply won't show up.
 */
function findProject(
  projects: Record<string, unknown>,
  projectRoot: string,
): Record<string, unknown> | null {
  const exact = asObject(projects[projectRoot]);
  if (exact) return exact;

  const trimmed = projectRoot.replace(/\/+$/, "");
  for (const [key, value] of Object.entries(projects)) {
    if (key.replace(/\/+$/, "") === trimmed) return asObject(value);
  }
  return null;
}

/** Transport from the server definition: explicit `type`, else inferred from url/command. */
export function transportOf(config: unknown): string {
  const obj = asObject(config);
  if (!obj) return "";
  if (typeof obj.type === "string") return obj.type;
  if (typeof obj.url === "string") return "http";
  if (typeof obj.command === "string") return "stdio";
  return "";
}

/** Turns the mcpServers object (name → definition) into a sorted list. */
function serversFrom(value: unknown): McpServerDef[] {
  const servers = asObject(value);
  if (!servers) return [];
  return Object.entries(servers)
    .map(([name, config]) => ({ name, transport: transportOf(config), config }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function safeParseObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    return asObject(JSON.parse(text));
  } catch {
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
