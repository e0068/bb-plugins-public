// bb-plugin-claude-config — бэкенд: разрешение областей, чтение и запись файлов
// настроек Claude Code и RPC-контракт для панели.
//
// Слой ввода-вывода. Вся логика сборки представления и правки документа — в
// чистых, покрытых тестами модулях под src/; здесь только проводка: разрешить
// пути области, прочитать файлы, отдать их в чистый слой, записать результат с
// CAS-защитой и превратить конфликт/битый файл в ответ, а не в исключение.
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import * as sd from "./src/settings-doc";
import { SettingsParseError } from "./src/settings-doc";
import {
  decideMcpOwn,
  resolvePlugin,
  resolveSkill,
  resolveToolSearch,
} from "./src/effective";
import { buildConfigView } from "./src/config-view";
import {
  parseClaudeJsonServers,
  parseInstalledPlugins,
  parseMcpJson,
} from "./src/catalog";

// --- схемы, общие для сервера и панели ---------------------------------

// Режим включённого навыка (без off) и цель записи (включая off). «inherit»
// в контракт не выносим: панель им не оперирует, сервер сам решает, когда
// оставить ключ, а когда снять.
const skillMode = z.enum(["on", "name-only", "user-invocable-only"]);
const skillTarget = z.enum(["on", "name-only", "user-invocable-only", "off"]);
// Подгрузка инструментов: режим при включённой (Всегда/Авто) и цель записи (+off).
const toolSearchModeOn = z.enum(["on", "auto"]);
const toolSearchTarget = z.enum(["on", "off", "auto"]);

// Итог записи: ok — записали; conflict — файл сменили под нами; parse-error —
// файл нельзя безопасно править; not-found — область не разрешилась.
const writeResult = z.object({
  outcome: z.enum(["ok", "conflict", "parse-error", "not-found"]),
  message: z.string().nullable(),
});

// Содержимое документа: `sha256` нужен панели для CAS-записи при правке.
const docContent = z.object({
  path: z.string(),
  content: z.string().nullable(),
  error: z.string().nullable(),
  sha256: z.string().nullable(),
});

const configOutput = z.object({
  areaLabel: z.string(),
  editedFilePath: z.string(),
  error: z
    .object({ file: z.string(), message: z.string() })
    .nullable(),
  plugins: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      marketplace: z.string(),
      version: z.string().nullable(),
      // Состояние свитча (действующее вкл/выкл) и гашение строки: в проекте
      // true, если совпадает с глобальным; глобально — всегда false.
      value: z.boolean(),
      dimmed: z.boolean(),
      // Каталог плагина — есть, если строку можно открыть.
      installPath: z.string().nullable(),
    }),
  ),
  connectors: z.array(
    z.object({
      name: z.string(),
      origin: z.enum(["mcpjson", "user", "local"]),
      transport: z.string(),
      // toggleable — только серверы .mcp.json; у read-only value всегда true.
      toggleable: z.boolean(),
      value: z.boolean(),
      dimmed: z.boolean(),
    }),
  ),
  skills: z.array(
    z.object({
      name: z.string(),
      origin: z.enum(["personal", "project"]),
      // Тоггл (вкл/выкл) и режим при включённом; в проекте dimmed — совпало
      // с глобальным.
      enabled: z.boolean(),
      mode: skillMode,
      dimmed: z.boolean(),
    }),
  ),
  hooks: z.array(
    z.object({
      event: z.string(),
      matcher: z.string().nullable(),
      command: z.string(),
      origin: z.enum(["user", "project", "local"]),
      index: z.number().int().nonnegative(),
    }),
  ),
  toolSearch: z.object({
    enabled: z.boolean(),
    mode: toolSearchModeOn,
    dimmed: z.boolean(),
  }),
});

/** Ответ getConfig — панель импортирует этот тип, чтобы не разъезжаться. */
export type AreaConfig = z.infer<typeof configOutput>;
/** Итог любой правки — тем же типом пользуется панель. */
export type WriteOutcome = z.infer<typeof writeResult>;

export const rpcContract = defineRpcContract({
  listAreas: {
    input: z.null(),
    output: z.object({
      areas: z.array(z.object({ id: z.string(), label: z.string() })),
    }),
  },
  getConfig: {
    input: z.object({ areaId: z.string() }).strict(),
    output: configOutput,
  },
  setPlugin: {
    // Свитч бинарный: value — желаемое действующее вкл/выкл в этой области.
    input: z
      .object({ areaId: z.string(), key: z.string(), value: z.boolean() })
      .strict(),
    output: writeResult,
  },
  setConnector: {
    // Тумблер сервера .mcp.json: value — желаемое действующее вкл/выкл в области.
    input: z
      .object({ areaId: z.string(), name: z.string(), value: z.boolean() })
      .strict(),
    output: writeResult,
  },
  setSkill: {
    input: z
      .object({ areaId: z.string(), name: z.string(), state: skillTarget })
      .strict(),
    output: writeResult,
  },
  setToolSearch: {
    input: z.object({ areaId: z.string(), mode: toolSearchTarget }).strict(),
    output: writeResult,
  },
  readConnector: {
    // Определение сервера как JSON для правой вкладки. origin выбирает источник:
    // .mcp.json проекта либо секции mcpServers в ~/.claude.json (user/local).
    input: z
      .object({
        areaId: z.string(),
        name: z.string(),
        origin: z.enum(["mcpjson", "user", "local"]),
      })
      .strict(),
    output: docContent,
  },
  readHook: {
    // Команда хука для правой вкладки. origin выбирает уровень (файл настроек),
    // index — позицию в списке хуков этого уровня (как в getConfig).
    input: z
      .object({
        areaId: z.string(),
        origin: z.enum(["user", "project", "local"]),
        index: z.number().int().nonnegative(),
      })
      .strict(),
    output: docContent,
  },
  readSkillFile: {
    // Имя навыка — из каталога (без `/`, чтобы не выйти за skills). `relPath`
    // — ссылка внутри SKILL.md относительно его папки; выход за пределы папки
    // навыка отсекает `rootPath` при чтении, здесь же — грубый фильтр символов.
    input: z
      .object({
        areaId: z.string(),
        name: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
        relPath: z.string().regex(/^[a-zA-Z0-9._/-]{1,300}$/),
      })
      .strict(),
    output: docContent,
  },
  listMemory: {
    // Файлы памяти, доступные в области (только реально существующие).
    input: z.object({ areaId: z.string() }).strict(),
    output: z.object({
      entries: z.array(
        z.object({ id: z.string(), label: z.string(), path: z.string() }),
      ),
    }),
  },
  readDoc: {
    // Читает любой файл в границах области (корень `.claude` и корень проекта).
    // Абсолютный путь приходит из UI (README плагина, файл памяти, ссылка внутри
    // документа), но выход за оба корня отсекается на сервере.
    input: z.object({ areaId: z.string(), path: z.string() }).strict(),
    output: docContent,
  },
  listDocPaths: {
    // Подсказки путей для / и @ в редакторе: файлы в поддереве папки документа,
    // пути относительно неё. В границах области; при ошибке тихо отдаёт [].
    input: z.object({ areaId: z.string(), path: z.string() }).strict(),
    output: z.object({ paths: z.array(z.string()) }),
  },
  readPlugin: {
    // Референс плагина: манифест (определение) и README, если он есть.
    input: z.object({ areaId: z.string(), key: z.string() }).strict(),
    output: z.object({
      manifestPath: z.string(),
      manifest: z.string().nullable(),
      readmePath: z.string().nullable(),
      readme: z.string().nullable(),
      error: z.string().nullable(),
    }),
  },
  writeDoc: {
    // Сохранение отредактированного документа с CAS: expectedSha256 из readDoc.
    // Те же границы области, что у чтения. sha256 при успехе — новый, для
    // продолжения правки без повторного чтения.
    input: z
      .object({
        areaId: z.string(),
        path: z.string(),
        content: z.string(),
        expectedSha256: z.string().nullable(),
      })
      .strict(),
    output: z.object({
      outcome: z.enum(["written", "conflict", "denied", "not-found"]),
      sha256: z.string().nullable(),
      message: z.string().nullable(),
    }),
  },
});

// --- разрешение области в набор путей ----------------------------------

const GLOBAL_ID = "global";

interface Area {
  kind: "global" | "project";
  label: string;
  /** Хост, на котором лежат файлы проекта (для глобальной — локальный). */
  hostId: string | undefined;
  /** Файл, который правит панель. */
  editedPath: string;
  /** Уровни от широкого к узкому для свёртки действующего значения. */
  levelPaths: string[];
  installedPath: string;
  personalSkillsDir: string;
  projectSkillsDir: string | null;
  /** Каталог `~/.claude` — для глобальной памяти и авто-памяти. */
  claudeHome: string;
  /** Корень проекта (для проектной памяти) или null в глобальной области. */
  projectRoot: string | null;
  /** `~/.claude.json` — user- и local-скоуп MCP-серверов (локальный хост). */
  claudeJsonPath: string;
  /** `<корень проекта>/.mcp.json` — коннекторы проекта; null в глобальной. */
  mcpJsonPath: string | null;
}

/**
 * Личный уровень (`~/.claude`) резолвится по домашнему каталогу сервера, то есть
 * локального хоста. Для проекта на удалённом хосте это приближение: проектные
 * файлы читаются на его хосте, а пользовательский уровень — локально. Общий
 * случай (проект на этой же машине) точен.
 */
function resolveArea(
  bb: BbPluginApi,
  areaId: string,
): Promise<Area | null> {
  const home = homedir();
  const claudeHome = join(home, ".claude");
  const claudeJsonPath = join(home, ".claude.json");
  const userSettings = join(home, ".claude", "settings.json");
  const installedPath = join(
    home,
    ".claude",
    "plugins",
    "installed_plugins.json",
  );
  const personalSkillsDir = join(home, ".claude", "skills");

  if (areaId === GLOBAL_ID) {
    return Promise.resolve({
      kind: "global",
      label: "Глобально",
      hostId: undefined,
      editedPath: userSettings,
      levelPaths: [userSettings],
      installedPath,
      personalSkillsDir,
      projectSkillsDir: null,
      claudeHome,
      projectRoot: null,
      claudeJsonPath,
      mcpJsonPath: null,
    });
  }

  return bb.sdk.projects.list().then((projects) => {
    const project = projects.find((candidate) => candidate.id === areaId);
    if (!project) return null;
    const source =
      project.sources.find((entry) => entry.isDefault) ?? project.sources[0];
    if (!source) return null;

    const projectClaude = join(source.path, ".claude");
    const projectSettings = join(projectClaude, "settings.json");
    const localSettings = join(projectClaude, "settings.local.json");
    return {
      kind: "project",
      label: project.name,
      hostId: source.hostId,
      editedPath: localSettings,
      levelPaths: [userSettings, projectSettings, localSettings],
      installedPath,
      personalSkillsDir,
      projectSkillsDir: join(projectClaude, "skills"),
      claudeHome,
      projectRoot: source.path,
      claudeJsonPath,
      mcpJsonPath: join(source.path, ".mcp.json"),
    };
  });
}

/**
 * Раскрывает ведущий `~` в домашний каталог хоста. Нужен для перехода по
 * Claude-импортам вида `@~/.claude/skills/x.md`: клик отдаёт путь с `~`, а
 * границы области и чтение требуют абсолютного пути. Как и `resolveArea`,
 * берёт homedir() сервера (локального хоста) — для `~/.claude` это точно.
 */
function expandTilde(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

/** Путь `target` лежит внутри каталога `root` (или равен ему). */
function isWithin(root: string, target: string): boolean {
  if (target === root) return true;
  return target.startsWith(root.endsWith("/") ? root : `${root}/`);
}

/**
 * Корень области, под которым лежит путь (и хост для чтения/записи), или null.
 * Границы — `~/.claude` (личное, навыки, плагины, авто-память) и корень проекта.
 */
function matchRoot(
  area: Area,
  path: string,
): { root: string; hostId: string | undefined } | null {
  const roots: { root: string; hostId: string | undefined }[] = [
    { root: area.claudeHome, hostId: undefined },
  ];
  if (area.projectRoot) {
    roots.push({ root: area.projectRoot, hostId: area.hostId });
  }
  return roots.find((entry) => isWithin(entry.root, path)) ?? null;
}

/** Файл памяти: id стабилен для RPC, путь и хост резолвит сервер. */
interface MemoryEntry {
  id: string;
  label: string;
  path: string;
  hostId: string | undefined;
}

/**
 * Кандидаты файлов памяти для области (без проверки существования). Глобальная
 * CLAUDE.md и авто-память живут на локальном хосте; проектные файлы — на хосте
 * проекта. Авто-память — каталог Claude Code по проекту: путь кодируется
 * заменой `/` на `-` (так их именует сам Claude Code).
 */
function memoryCandidates(area: Area): MemoryEntry[] {
  const list: MemoryEntry[] = [
    {
      id: "global-claude",
      label: "Глобальная CLAUDE.md",
      path: join(area.claudeHome, "CLAUDE.md"),
      hostId: undefined,
    },
  ];
  if (area.kind === "project" && area.projectRoot) {
    const root = area.projectRoot;
    const enc = root.replace(/\//g, "-");
    list.push(
      { id: "project-claude", label: "Проектная CLAUDE.md", path: join(root, "CLAUDE.md"), hostId: area.hostId },
      { id: "project-claude-local", label: "CLAUDE.local.md", path: join(root, "CLAUDE.local.md"), hostId: area.hostId },
      { id: "project-agents", label: "AGENTS.md", path: join(root, "AGENTS.md"), hostId: area.hostId },
      { id: "project-memory", label: "memory/MEMORY.md", path: join(root, "memory", "MEMORY.md"), hostId: area.hostId },
      { id: "project-memory-index", label: "memory/INDEX.md", path: join(root, "memory", "INDEX.md"), hostId: area.hostId },
      { id: "auto-memory", label: "Авто-память MEMORY.md", path: join(area.claudeHome, "projects", enc, "memory", "MEMORY.md"), hostId: undefined },
    );
  }
  return list;
}

// Секция настроек как уровневое поле: чтение/запись «своего» значения и свёртка
// уровней. `default` — значение-умолчание, которое в файле не хранится (для
// плагинов «выкл», для навыков «полностью»). Позволяет писать плагины и навыки
// одним помощником.
interface LeveledSection<S extends string> {
  default: S;
  get(document: sd.SettingsDoc, key: string): S;
  set(document: sd.SettingsDoc, key: string, own: S): sd.SettingsDoc;
  resolve(levels: S[]): string;
}

const PLUGIN_SECTION: LeveledSection<sd.PluginToggle> = {
  default: "off",
  get: sd.getPlugin,
  set: sd.setPlugin,
  resolve: resolvePlugin,
};

const SKILL_SECTION: LeveledSection<sd.SkillState> = {
  default: "on",
  get: sd.getSkill,
  set: sd.setSkill,
  resolve: resolveSkill,
};

// Подгрузка инструментов — единственное поле (ключ env фиксирован), поэтому
// `key` игнорируется. Умолчание — auto: неустановленная переменная так и ведёт.
const TOOLSEARCH_SECTION: LeveledSection<sd.ToolSearchMode> = {
  default: "auto",
  get: (document) => sd.getToolSearch(document),
  set: (document, _key, own) => sd.setToolSearch(document, own),
  resolve: resolveToolSearch,
};

export default function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  // Чтение файла: отсутствие — это пустой документ (text=null), а не ошибка.
  // sha нужен для CAS-записи; при отсутствии файла запись пойдёт как create-only.
  async function readFile(
    path: string,
    hostId: string | undefined,
    rootPath?: string,
  ): Promise<{ text: string | null; sha256: string | null }> {
    try {
      const file = await bb.sdk.files.read({ path, hostId, rootPath });
      const text =
        file.contentEncoding === "base64"
          ? Buffer.from(file.content, "base64").toString("utf8")
          : file.content;
      return { text, sha256: file.sha256 };
    } catch {
      return { text: null, sha256: null };
    }
  }

  async function listSkillPaths(
    dir: string | null,
    hostId: string | undefined,
  ): Promise<string[]> {
    if (!dir) return [];
    try {
      const result = await bb.sdk.files.listPaths({
        path: dir,
        hostId,
        includeFiles: true,
        includeDirectories: false,
        limit: 5000,
      });
      return result.paths.map((entry) => entry.path);
    } catch {
      return [];
    }
  }

  bb.rpc.register(rpcContract, {
    async listAreas() {
      const projects = await bb.sdk.projects.list();
      return {
        areas: [
          { id: GLOBAL_ID, label: "Глобально" },
          ...projects.map((project) => ({
            id: project.id,
            label: project.name,
          })),
        ],
      };
    },

    async getConfig({ areaId }) {
      const area = await resolveArea(bb, areaId);
      if (!area) {
        return emptyConfig("—", "", {
          file: "",
          message: "Область не найдена.",
        });
      }

      // Разбор каждого уровня с привязкой к файлу: битый JSON — сообщение в UI,
      // а не подмена пустым документом (иначе первая запись затёрла бы файл).
      const parsedLevels: sd.SettingsDoc[] = [];
      for (const path of area.levelPaths) {
        const { text } = await readFile(path, area.hostId);
        try {
          parsedLevels.push(sd.parse(text));
        } catch (error) {
          if (error instanceof SettingsParseError) {
            return emptyConfig(area.label, area.editedPath, {
              file: path,
              message: error.message,
            });
          }
          throw error;
        }
      }
      // Редактируемый файл — последний из уровней (локальный или глобальный).
      const editedDoc = parsedLevels[parsedLevels.length - 1] ?? {};

      const installed = await readFile(area.installedPath, area.hostId);
      // .mcp.json — на хосте проекта; ~/.claude.json — на локальном хосте.
      const mcpJson = area.mcpJsonPath
        ? await readFile(area.mcpJsonPath, area.hostId)
        : { text: null, sha256: null };
      const claudeJson = await readFile(area.claudeJsonPath, undefined);
      const [personalSkillPaths, projectSkillPaths] = await Promise.all([
        listSkillPaths(area.personalSkillsDir, area.hostId),
        listSkillPaths(area.projectSkillsDir, area.hostId),
      ]);

      // Происхождение уровней: глобально один (user), в проекте три по порядку.
      const levelOrigins =
        area.kind === "global"
          ? (["user"] as const)
          : (["user", "project", "local"] as const);

      const view = buildConfigView({
        areaKind: area.kind,
        editedDoc,
        levelDocs: parsedLevels,
        installedPluginsText: installed.text,
        personalSkillPaths,
        projectSkillPaths,
        mcpJsonText: mcpJson.text,
        claudeJsonText: claudeJson.text,
        projectRoot: area.projectRoot,
        levelOrigins: [...levelOrigins],
      });

      return {
        areaLabel: area.label,
        editedFilePath: area.editedPath,
        error: null,
        ...view,
      };
    },

    setPlugin({ areaId, key, value }) {
      return writeLeveled(areaId, key, PLUGIN_SECTION, value ? "on" : "off");
    },

    setConnector({ areaId, name, value }) {
      return writeConnector(areaId, name, value);
    },

    setSkill({ areaId, name, state }) {
      return writeLeveled(areaId, name, SKILL_SECTION, state);
    },

    setToolSearch({ areaId, mode }) {
      return writeLeveled(areaId, "", TOOLSEARCH_SECTION, mode);
    },

    async readConnector({ areaId, name, origin }) {
      const notFound = {
        path: "",
        content: null,
        error: "Коннектор не найден.",
        sha256: null,
      };
      const area = await resolveArea(bb, areaId);
      if (!area) {
        return { path: "", content: null, error: "Область не найдена.", sha256: null };
      }

      let config: unknown;
      let path: string;
      if (origin === "mcpjson") {
        if (!area.mcpJsonPath) return notFound;
        const { text } = await readFile(area.mcpJsonPath, area.hostId);
        config = parseMcpJson(text).find((server) => server.name === name)?.config;
        path = area.mcpJsonPath;
      } else {
        // user/local — из ~/.claude.json на локальном хосте.
        const { text } = await readFile(area.claudeJsonPath, undefined);
        const { user, local } = parseClaudeJsonServers(text, area.projectRoot);
        const list = origin === "user" ? user : local;
        config = list.find((server) => server.name === name)?.config;
        path = area.claudeJsonPath;
      }

      if (config === undefined) return notFound;
      return {
        path,
        content: JSON.stringify(config, null, 2),
        error: null,
        sha256: null,
      };
    },

    async readHook({ areaId, origin, index }) {
      const area = await resolveArea(bb, areaId);
      if (!area) {
        return { path: "", content: null, error: "Область не найдена.", sha256: null };
      }
      // origin → уровень: user/project/local соответствуют порядку levelPaths.
      const levelIndex = { user: 0, project: 1, local: 2 }[origin];
      const path = area.levelPaths[levelIndex];
      if (!path) {
        return { path: "", content: null, error: "Хук не найден.", sha256: null };
      }
      const { text } = await readFile(path, area.hostId);
      let hook;
      try {
        hook = sd.listHooks(sd.parse(text))[index];
      } catch (error) {
        if (error instanceof SettingsParseError) {
          return { path, content: null, error: error.message, sha256: null };
        }
        throw error;
      }
      if (!hook) {
        return { path, content: null, error: "Хук не найден.", sha256: null };
      }
      const header = hook.matcher
        ? `**${hook.event}** · matcher: \`${hook.matcher}\`\n\n`
        : `**${hook.event}**\n\n`;
      return {
        path,
        content: `${header}\`\`\`bash\n${hook.command}\n\`\`\``,
        error: null,
        sha256: null,
      };
    },

    async readSkillFile({ areaId, name, relPath }) {
      const area = await resolveArea(bb, areaId);
      if (!area) {
        return { path: "", content: null, error: "Область не найдена.", sha256: null };
      }

      // Ссылки внутри навыка считаем относительно папки его SKILL.md, а читаем
      // с confinement по корню `.claude` — так штатная ссылка `../../CONNECTORS.md`
      // на общий для всех навыков файл проходит, а выход за `.claude` (ssh-ключи
      // и прочее) остаётся закрыт.
      const found = await findSkill(area, name);
      if (!found) {
        return { path: "", content: null, error: "SKILL.md не найден.", sha256: null };
      }

      const target = join(found.base, relPath);
      const { text, sha256 } = await readFile(target, area.hostId, found.root);
      if (text === null) {
        return { path: "", content: null, error: "Файл не найден.", sha256: null };
      }
      return { path: target, content: text, error: null, sha256 };
    },

    async listMemory({ areaId }) {
      const area = await resolveArea(bb, areaId);
      if (!area) return { entries: [] };
      const entries: { id: string; label: string; path: string }[] = [];
      for (const candidate of memoryCandidates(area)) {
        const { text } = await readFile(candidate.path, candidate.hostId);
        if (text !== null) {
          entries.push({
            id: candidate.id,
            label: candidate.label,
            path: candidate.path,
          });
        }
      }
      return { entries };
    },

    async readDoc({ areaId, path }) {
      const area = await resolveArea(bb, areaId);
      if (!area) {
        return { path: "", content: null, error: "Область не найдена.", sha256: null };
      }
      // Раскрываем `~` (переход по @-импорту отдаёт путь с ~) и возвращаем уже
      // абсолютный путь — от него фронт считает вложенные ссылки.
      const abs = expandTilde(path);
      const match = matchRoot(area, abs);
      if (!match) {
        return { path: "", content: null, error: "Путь вне доступных папок.", sha256: null };
      }
      const { text, sha256 } = await readFile(abs, match.hostId, match.root);
      if (text === null) {
        return { path: "", content: null, error: "Файл не найден.", sha256: null };
      }
      return { path: abs, content: text, error: null, sha256 };
    },

    async listDocPaths({ areaId, path }) {
      const area = await resolveArea(bb, areaId);
      if (!area) return { paths: [] };
      const dir = dirname(expandTilde(path));
      const match = matchRoot(area, dir);
      if (!match) return { paths: [] };
      try {
        const result = await bb.sdk.files.listPaths({
          path: dir,
          hostId: match.hostId,
          includeFiles: true,
          includeDirectories: false,
          limit: 2000,
        });
        const prefix = dir.endsWith("/") ? dir : dir + "/";
        const paths = result.paths
          .map((entry) =>
            entry.path.startsWith(prefix)
              ? entry.path.slice(prefix.length)
              : entry.path,
          )
          .filter(
            (p) =>
              p.length > 0 &&
              !p.startsWith(".git/") &&
              !p.startsWith("node_modules/") &&
              !p.includes("/node_modules/"),
          );
        return { paths };
      } catch {
        return { paths: [] };
      }
    },

    async readPlugin({ areaId, key }) {
      const empty = {
        manifestPath: "",
        manifest: null,
        readmePath: null,
        readme: null,
      };
      const area = await resolveArea(bb, areaId);
      if (!area) return { ...empty, error: "Область не найдена." };

      // installPath берём из installed_plugins.json (он на локальном хосте).
      const installed = await readFile(area.installedPath, undefined);
      const plugin = parseInstalledPlugins(installed.text).find(
        (entry) => entry.key === key,
      );
      if (!plugin?.installPath) return { ...empty, error: "Плагин не найден." };

      const base = plugin.installPath;
      const manifestPath = join(base, ".claude-plugin", "plugin.json");
      const manifest = await readFile(manifestPath, undefined, area.claudeHome);

      // README необязателен: у части плагинов его нет — тогда readme = null.
      let readmePath: string | null = null;
      let readme: string | null = null;
      for (const name of ["README.md", "readme.md"]) {
        const candidate = join(base, name);
        const { text } = await readFile(candidate, undefined, area.claudeHome);
        if (text !== null) {
          readmePath = candidate;
          readme = text;
          break;
        }
      }
      return {
        manifestPath,
        manifest: manifest.text,
        readmePath,
        readme,
        error: manifest.text === null ? "Манифест не найден." : null,
      };
    },

    async writeDoc({ areaId, path, content, expectedSha256 }) {
      const area = await resolveArea(bb, areaId);
      if (!area) {
        return { outcome: "not-found" as const, sha256: null, message: "Область не найдена." };
      }
      const match = matchRoot(area, path);
      if (!match) {
        return { outcome: "denied" as const, sha256: null, message: "Путь вне доступных папок." };
      }
      const written = await bb.sdk.files.write({
        path,
        hostId: match.hostId,
        rootPath: match.root,
        content,
        expectedSha256,
      });
      if (written.outcome === "conflict") {
        return {
          outcome: "conflict" as const,
          sha256: written.currentSha256,
          message: "Файл изменился на диске. Обновите и повторите.",
        };
      }
      return { outcome: "written" as const, sha256: written.sha256, message: null };
    },
  });

  /**
   * Находит навык: `base` — папка его SKILL.md (проектная перекрывает личную),
   * `root` — корень `.claude`, за пределы которого чтение по ссылкам не пускаем.
   */
  async function findSkill(
    area: Area,
    name: string,
  ): Promise<{ base: string; root: string } | null> {
    const dirs = [area.projectSkillsDir, area.personalSkillsDir].filter(
      (dir): dir is string => dir !== null,
    );
    for (const dir of dirs) {
      for (const rel of [`${name}/SKILL.md`, `synced/${name}/SKILL.md`]) {
        const { text } = await readFile(join(dir, rel), area.hostId, dir);
        if (text !== null) {
          return { base: dirname(join(dir, rel)), root: dirname(dir) };
        }
      }
    }
    return null;
  }

  /**
   * Ставит уровневое поле (плагин или навык) в желаемое действующее значение,
   * записывая минимум. Глобально уровень один: `default` убирает ключ, иначе
   * пишем явно. В проекте, если старшие уровни уже дают `target`, локальный
   * оверрайд снимаем (строка «как глобально», UI её гасит); иначе ставим явно.
   */
  async function writeLeveled<S extends string>(
    areaId: string,
    key: string,
    section: LeveledSection<S>,
    target: S,
  ): Promise<WriteOutcome> {
    const area = await resolveArea(bb, areaId);
    if (!area) return { outcome: "not-found", message: "Область не найдена." };

    // И PluginToggle, и SkillState включают «inherit» — снятие ключа из файла.
    const inherit = "inherit" as S;

    if (area.kind === "global") {
      const own = target === section.default ? inherit : target;
      return applyEdit(areaId, (document) => section.set(document, key, own));
    }

    const broader: S[] = [];
    for (const path of area.levelPaths.slice(0, -1)) {
      const { text } = await readFile(path, area.hostId);
      try {
        broader.push(section.get(sd.parse(text), key));
      } catch (error) {
        if (error instanceof SettingsParseError) {
          return { outcome: "parse-error", message: error.message };
        }
        throw error;
      }
    }
    const own = section.resolve(broader) === target ? inherit : target;
    return applyEdit(areaId, (document) => section.set(document, key, own));
  }

  /**
   * Тумблер MCP-сервера из .mcp.json. Хранится двумя массивами и учитывает
   * `enableAllProjectMcpServers`, поэтому не ложится в общий `writeLeveled`:
   * умолчание зависит от enableAll, а `setMcpServer` правит два ключа. Логика та
   * же — пишем минимум: если старшие уровни уже дают target, локальный оверрайд
   * снимаем (сервер вон из обоих массивов), иначе ставим явно.
   */
  async function writeConnector(
    areaId: string,
    name: string,
    value: boolean,
  ): Promise<WriteOutcome> {
    const area = await resolveArea(bb, areaId);
    if (!area) return { outcome: "not-found", message: "Область не найдена." };
    const target = value ? "on" : "off";

    // Состояния сервера берём с уровней старше редактируемого (при снятии
    // оверрайда его собственное значение станет inherit). А enableAll — со ВСЕХ
    // уровней, включая редактируемый: setMcpServer его не трогает, и он остаётся
    // задавать умолчание.
    const broaderStates: sd.McpServerState[] = [];
    const enableAllLevels: (boolean | undefined)[] = [];
    for (const [index, path] of area.levelPaths.entries()) {
      const { text } = await readFile(path, area.hostId);
      let parsed: sd.SettingsDoc;
      try {
        parsed = sd.parse(text);
      } catch (error) {
        if (error instanceof SettingsParseError) {
          return { outcome: "parse-error", message: error.message };
        }
        throw error;
      }
      if (index < area.levelPaths.length - 1) {
        broaderStates.push(sd.getMcpServer(parsed, name));
      }
      enableAllLevels.push(sd.getEnableAllMcp(parsed));
    }
    const own = decideMcpOwn(broaderStates, enableAllLevels, target);
    return applyEdit(areaId, (document) => sd.setMcpServer(document, name, own));
  }

  /**
   * Читает редактируемый файл заново (свежий sha), применяет чистую правку и
   * пишет с CAS-защитой. Свежее чтение прямо перед записью и делает правку
   * атомарной против параллельной сессии Claude Code: чужая запись между нашим
   * чтением и записью не совпадёт по sha и вернётся конфликтом, а не затиранием.
   */
  async function applyEdit(
    areaId: string,
    edit: (doc: sd.SettingsDoc) => sd.SettingsDoc,
  ): Promise<{ outcome: "ok" | "conflict" | "parse-error" | "not-found"; message: string | null }> {
    const area = await resolveArea(bb, areaId);
    if (!area) return { outcome: "not-found", message: "Область не найдена." };

    const { text, sha256 } = await readFile(area.editedPath, area.hostId);
    let doc: sd.SettingsDoc;
    try {
      doc = sd.parse(text);
    } catch (error) {
      if (error instanceof SettingsParseError) {
        return { outcome: "parse-error", message: error.message };
      }
      throw error;
    }

    const next = sd.serialize(edit(doc));
    const written = await bb.sdk.files.write({
      path: area.editedPath,
      hostId: area.hostId,
      content: next,
      // Есть sha — пишем только поверх той же версии; нет файла — create-only.
      expectedSha256: sha256 ?? null,
      createParents: true,
    });
    if (written.outcome === "conflict") {
      return {
        outcome: "conflict",
        message: "Файл изменила другая сессия. Обновите и повторите.",
      };
    }
    return { outcome: "ok", message: null };
  }

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}

function emptyConfig(
  areaLabel: string,
  editedFilePath: string,
  error: { file: string; message: string } | null,
) {
  return {
    areaLabel,
    editedFilePath,
    error,
    plugins: [],
    connectors: [],
    skills: [],
    hooks: [],
    toolSearch: { enabled: true as const, mode: "auto" as const, dimmed: false },
  };
}
