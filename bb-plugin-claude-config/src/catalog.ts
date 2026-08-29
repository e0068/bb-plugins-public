// Слой 2 — что вообще есть на машине: установленные плагины и навыки.
// Разбор без ввода-вывода: на входе содержимое файлов и списки путей.

export interface InstalledPlugin {
  /** Ключ вида `name@marketplace` — им же плагин зовётся в enabledPlugins. */
  key: string;
  /** Короткое имя без маркетплейса — для показа. */
  name: string;
  marketplace: string;
  version: string | null;
  /** Каталог установки плагина — в нём лежит README (референс плагина). */
  installPath: string | null;
}

export interface SkillEntry {
  /** Имя, которым навык зовётся в skillOverrides и после слэша. */
  name: string;
  origin: "personal" | "project";
}

export interface McpServerDef {
  /** Имя сервера — ключ в объекте mcpServers. */
  name: string;
  /** Транспорт для подписи: `stdio`, `http`, `sse`… (или пусто, если не понять). */
  transport: string;
  /** Определение сервера как есть — для показа JSON в правой вкладке. */
  config: unknown;
}

/**
 * Разбирает `~/.claude/plugins/installed_plugins.json` (схема версии 2:
 * ключ плагина → массив установок по областям).
 *
 * Файл принадлежит Claude Code, а не нам, поэтому разбор терпимый: незнакомая
 * форма даёт пустой список, а не исключение — панель должна открыться и
 * показать хотя бы то, что упомянуто в самих настройках.
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
 * Собирает имена навыков из списка путей внутри каталога навыков.
 *
 * Навык — это каталог с `SKILL.md`, поэтому имя берётся из первого сегмента
 * пути к такому файлу. Служебный каталог `synced/` (навыки, синхронизированные
 * с claude.ai) даёт вложенный уровень — его имя берётся из второго сегмента.
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
 * Собирает имена агентов из списка путей внутри каталога агентов.
 *
 * Агент — это одиночный файл `<имя>.md` прямо в каталоге агентов, поэтому имя
 * берётся из имени файла без расширения. Вложенные пути (файлы в подпапках) не
 * считаются агентами и пропускаются.
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

/** Сливает каталоги двух областей: имя из проекта перекрывает личное. */
export function mergeSkills(
  personal: string[],
  project: string[],
): SkillEntry[] {
  return mergeNamed(personal, project);
}

/** Сливает списки имён агентов двух областей: проектное перекрывает личное. */
export function mergeAgents(
  personal: string[],
  project: string[],
): SkillEntry[] {
  return mergeNamed(personal, project);
}

/** Слияние по имени: проектная запись перекрывает личную, результат отсортирован. */
function mergeNamed(personal: string[], project: string[]): SkillEntry[] {
  const byName = new Map<string, SkillEntry>();
  for (const name of personal) byName.set(name, { name, origin: "personal" });
  for (const name of project) byName.set(name, { name, origin: "project" });
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Разбирает серверы из проектного `.mcp.json` (форма `{ mcpServers: {...} }`).
 * Файл общий и не наш — разбор терпимый: незнакомая форма даёт пустой список.
 */
export function parseMcpJson(text: string | null): McpServerDef[] {
  const root = safeParseObject(text);
  return serversFrom(root && root.mcpServers);
}

/**
 * Серверы из `~/.claude.json`: верхнеуровневый `mcpServers` — user-скоуп;
 * `projects[<корень>].mcpServers` — local-скоуп текущего проекта (пусто, если
 * корень не задан или проекта нет в файле).
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
 * Ищет проект по корню в `projects` из `~/.claude.json`. Сначала точное
 * совпадение ключа, затем — с точностью до хвостового `/` с обеих сторон: bb и
 * Claude Code могут записать путь по-разному. Регистр и симлинки не разрешаем
 * (нужна ФС) — редкие случаи, где local-серверы просто не покажутся.
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

/** Транспорт из определения сервера: явный `type`, иначе по наличию url/command. */
export function transportOf(config: unknown): string {
  const obj = asObject(config);
  if (!obj) return "";
  if (typeof obj.type === "string") return obj.type;
  if (typeof obj.url === "string") return "http";
  if (typeof obj.command === "string") return "stdio";
  return "";
}

/** Превращает объект mcpServers (имя → определение) в отсортированный список. */
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
