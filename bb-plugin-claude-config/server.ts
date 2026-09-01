// bb-plugin-claude-config — бэкенд: разрешение областей, чтение и запись файлов
// настроек Claude Code и RPC-контракт для панели.
//
// Слой ввода-вывода. Вся логика сборки представления и правки документа — в
// чистых, покрытых тестами модулях под src/; здесь только проводка: разрешить
// пути области, прочитать файлы, отдать их в чистый слой, записать результат с
// CAS-защитой и превратить конфликт/битый файл в ответ, а не в исключение.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix as posixPath, resolve } from "node:path";
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
import { estimateTokens } from "./src/weight";
import {
  parseClaudeJsonServers,
  parseInstalledPlugins,
  parseMcpJson,
} from "./src/catalog";
import { parseImports, resolveImportPath } from "./src/imports";
import { extractCommandFile } from "./src/hook-script";
import {
  agentTemplate,
  isValidName,
  skillTemplate,
  slugifyName,
} from "./src/scaffold";
// Прямой импорт чистого модуля (не barrel index): иначе сервер потянул бы
// React-компонент MdDocView и его CSS в серверный бандл.
import {
  NATIVE_VIEWER_TOKEN_DEFAULTS,
  buildDescriptors,
} from "./packages/md-doc-view/kasimov-settings";
// Перенос workflow-конструктора (bb-plugin-workflow-composer → сюда): ядро
// дерево↔.js остаётся DOM-свободным модулем под src/workflow, сервер здесь
// лишь читает/пишет файлы и зовёт `bb workflows` — как и в исходном плагине.
import { parse as parseWorkflow, readMetaDescription } from "./src/workflow/workflow-model";

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

// Итог создания навыка/агента. `created` — файл записан, `path` ведёт к нему
// (панель его открывает); `exists` — файл с таким именем уже есть; `invalid`
// — во вводе не осталось допустимых символов; `not-found` — область не найдена.
const createResult = z.object({
  outcome: z.enum(["created", "exists", "invalid", "not-found"]),
  path: z.string().nullable(),
  message: z.string().nullable(),
});

// Содержимое документа: `sha256` нужен панели для CAS-записи при правке.
const docContent = z.object({
  path: z.string(),
  content: z.string().nullable(),
  error: z.string().nullable(),
  sha256: z.string().nullable(),
});

// Хук для правой вкладки: в отличие от `docContent`, отдаёт сырую команду
// (не markdown) и `sha256`, чтобы панель могла её отредактировать и сохранить
// через `writeHook` с CAS. `event`/`matcher` — для заголовка вкладки.
// `definition` — весь хук как JSON (контекст для показа), `filePath`/
// `fileContent` — файл, который команда читает или запускает (`cat x.json`,
// `bash foo.sh`), если он опознан и прочитан в границах области.
const hookDetail = z.object({
  path: z.string(),
  command: z.string().nullable(),
  error: z.string().nullable(),
  sha256: z.string().nullable(),
  event: z.string().nullable(),
  matcher: z.string().nullable(),
  definition: z.string().nullable(),
  filePath: z.string().nullable(),
  fileContent: z.string().nullable(),
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
      // Оценка «веса» в токенах (манифест+README); null — не удалось прочитать.
      tokens: z.number().nullable(),
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
      // Оценка веса определения коннектора в токенах.
      tokens: z.number().nullable(),
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
      // Абсолютный путь к SKILL.md — панель открывает его хостовым опенером.
      // null — навык-сирота (строка override осталась, файла на диске нет).
      path: z.string().nullable(),
      // Оценка веса SKILL.md в токенах.
      tokens: z.number().nullable(),
    }),
  ),
  agents: z.array(
    z.object({
      name: z.string(),
      origin: z.enum(["personal", "project"]),
      // Абсолютный путь к файлу агента — панель открывает его по нему.
      path: z.string(),
      // Оценка веса файла агента в токенах.
      tokens: z.number().nullable(),
    }),
  ),
  hooks: z.array(
    z.object({
      event: z.string(),
      matcher: z.string().nullable(),
      command: z.string(),
      origin: z.enum(["user", "project", "local"]),
      index: z.number().int().nonnegative(),
      // false — хук вырезан из файла и лежит в disabled-хранилище (см. setHookEnabled).
      enabled: z.boolean(),
    }),
  ),
  toolSearch: z.object({
    enabled: z.boolean(),
    mode: toolSearchModeOn,
    dimmed: z.boolean(),
  }),
});

// --- схемы workflow-конструктора (перенос bb-plugin-workflow-composer) ---
// Дословно из его rpcContract; ключи здесь несут префикс wf, чтобы не
// столкнуться с одноимёнными процедурами этого плагина (list/read/save и т.п.
// уже заняты областями настроек).

const wfStoreEnum = z.enum(["project", "global"]);

const wfWorkflowItem = z.object({
  name: z.string(),
  path: z.string(),
  store: wfStoreEnum,
  description: z.string(),
  hasTree: z.boolean(),
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
    // index — позицию в списке хуков этого уровня (как в getConfig). В отличие
    // от readConnector/readSkillFile отдаёт сырую команду и sha256 — панель
    // умеет её редактировать (см. writeHook).
    input: z
      .object({
        areaId: z.string(),
        origin: z.enum(["user", "project", "local"]),
        index: z.number().int().nonnegative(),
      })
      .strict(),
    output: hookDetail,
  },
  writeHook: {
    // Сохранение отредактированной команды хука с CAS: expectedSha256 из readHook.
    input: z
      .object({
        areaId: z.string(),
        origin: z.enum(["user", "project", "local"]),
        index: z.number().int().nonnegative(),
        command: z.string(),
        expectedSha256: z.string().nullable(),
      })
      .strict(),
    output: z.object({
      outcome: z.enum(["written", "conflict", "denied", "not-found"]),
      sha256: z.string().nullable(),
      message: z.string().nullable(),
    }),
  },
  setHookEnabled: {
    // Тумблер хука: выключение вырезает запись из файла уровня и хранит её в
    // kv (disabledHooks:<путь>), включение возвращает её на место. Идентичность
    // хука — event+matcher+command (см. sameHook), позиции индексов при этом не
    // используются: они смещаются при каждой правке файла.
    input: z
      .object({
        areaId: z.string(),
        origin: z.enum(["user", "project", "local"]),
        event: z.string(),
        matcher: z.string().nullable(),
        command: z.string(),
        enabled: z.boolean(),
      })
      .strict(),
    output: writeResult,
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
    // Файлы памяти, доступные в области: базовые кандидаты плюс их @-импорты,
    // разобранные транзитивно (CLAUDE.md → навыки → их собственные импорты).
    // Только реально существующие файлы.
    input: z.object({ areaId: z.string() }).strict(),
    output: z.object({
      entries: z.array(
        z.object({ id: z.string(), label: z.string(), path: z.string() }),
      ),
    }),
  },
  listRefTargets: {
    // Полный список целей, на которые можно сослаться через @ (навыки и файлы
    // памяти); ранжирование по запросу — на панели, через suggest.rankCandidates.
    input: z.object({ areaId: z.string() }).strict(),
    output: z.object({
      targets: z.array(
        z.object({
          value: z.string(),
          label: z.string(),
          kind: z.enum(["skill", "memory"]),
        }),
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
  resolveOpenTarget: {
    // Хост для файла в границах области: панель открывает его нативным опенером
    // bb (experimental_openFilePreview) целью { kind: "host", hostId, path }.
    // Для проектных файлов — хост источника проекта, для личных (~/.claude) —
    // primaryHostId сервера. hostId=null — путь вне границ или хост неизвестен.
    input: z.object({ areaId: z.string(), path: z.string() }).strict(),
    output: z.object({
      hostId: z.string().nullable(),
      error: z.string().nullable(),
    }),
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
  createSkill: {
    // Создаёт новый навык `<slug>/SKILL.md` в каталоге навыков области (в проекте
    // — проектный, глобально — личный). Имя нормализуется в слаг на сервере.
    // `exists` — навык с таким слагом уже есть (create-only не перезаписывает).
    input: z.object({ areaId: z.string(), name: z.string() }).strict(),
    output: createResult,
  },
  createAgent: {
    // Создаёт новый файл агента `<slug>.md` в каталоге агентов области. Правила
    // выбора каталога и нормализации имени — как у createSkill.
    input: z.object({ areaId: z.string(), name: z.string() }).strict(),
    output: createResult,
  },

  // ---- workflow-конструктор (перенос bb-plugin-workflow-composer) ----
  // Оба хранилища (project `.bb/workflows/` + global `~/.claude/workflows/`),
  // сплюснутые в один список. projectId может быть null (нет проекта в
  // фокусе) → проектное хранилище пропускается.
  wfList: {
    input: z.object({ projectId: z.string().nullable() }).strict(),
    output: z.object({ items: z.array(wfWorkflowItem) }),
  },
  wfRead: {
    input: z
      .object({ projectId: z.string().nullable(), store: wfStoreEnum, path: z.string() })
      .strict(),
    output: z.object({ source: z.string(), tree: z.unknown().nullable() }),
  },
  wfSave: {
    input: z
      .object({
        projectId: z.string().nullable(),
        store: wfStoreEnum,
        name: z.string(),
        source: z.string(),
      })
      .strict(),
    output: z.object({ path: z.string() }),
  },
  wfRemove: {
    input: z
      .object({ projectId: z.string().nullable(), store: wfStoreEnum, path: z.string() })
      .strict(),
    output: z.object({ ok: z.boolean() }),
  },
  wfValidate: {
    input: z
      .object({ projectId: z.string().nullable(), store: wfStoreEnum, path: z.string() })
      .strict(),
    output: z.object({ ok: z.boolean(), output: z.string() }),
  },
  wfRun: {
    input: z
      .object({ projectId: z.string().nullable(), store: wfStoreEnum, path: z.string() })
      .strict(),
    output: z.object({ ok: z.boolean(), runId: z.string().nullable(), output: z.string() }),
  },
  wfStatus: {
    input: z.object({ runId: z.string() }).strict(),
    output: z.object({ output: z.string() }),
  },
  // Проекты, которые можно выбрать в селекторе шапки — панель не привязана
  // только к тому проекту, что сейчас в фокусе у хоста.
  wfProjects: {
    input: z.null(),
    output: z.array(z.object({ id: z.string(), name: z.string() })),
  },
  // Типы агентов из личных (~/.claude/agents), проектных (.claude/agents) и
  // плагинных (~/.claude/plugins/**/agents) каталогов — автокомплит «Agent
  // type», плюс собственные модель/effort/provider агента (из frontmatter).
  wfAgents: {
    input: z.object({ projectId: z.string().nullable() }).strict(),
    output: z.object({
      agents: z.array(
        z.object({
          value: z.string(),
          model: z.string(),
          effort: z.string(),
          provider: z.string(),
          description: z.string(),
          path: z.string(),
          tools: z.array(z.string()),
          scope: z.enum(["user", "project", "plugin"]),
        }),
      ),
    }),
  },
  // Живой каталог провайдер/модель/effort (bb.sdk.providers.list + .models на
  // провайдера) для колонки деталей агента.
  wfProviderCatalog: {
    input: z.null(),
    output: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        models: z.array(z.object({ id: z.string(), efforts: z.array(z.string()) })),
      }),
    ),
  },
  // Пишет полный .md агента (frontmatter + тело) на диск. Сервер — «тупой
  // писатель»: содержимое собирает клиент, здесь только валидация имени/области
  // и ограждение пути записи.
  wfWriteAgent: {
    input: z
      .object({
        projectId: z.string().nullable(),
        scope: z.enum(["user", "project"]),
        name: z.string(),
        content: z.string(),
        overwrite: z.boolean(),
      })
      .strict(),
    output: z.object({ path: z.string() }),
  },
});

// --- workflow-конструктор: чистые функции и общие типы (перенос) --------
// Перенесено дословно из bb-plugin-workflow-composer/server.ts: чистые
// функции модульного уровня плюс приватные хелперы, которых требуют
// перенесённые wf*-обработчики. Обработчики agentRefs/models остались в
// исходном плагине и сюда не переносились — вместе с ними не переносились и
// их собственные хелперы (MD_REF_RE, candidatesForToken, listModels).

type WfStore = z.infer<typeof wfStoreEnum>;

const WORKFLOW_EXT = ".js";
const WF_MARKER = "/.bb/workflows/"; // project workflows live directly under a checkout's .bb/workflows

function joinPath(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
}

function baseName(path: string): string {
  const seg = path.split("/").pop() ?? path;
  return seg.endsWith(WORKFLOW_EXT) ? seg.slice(0, -WORKFLOW_EXT.length) : seg;
}

// The checkout root of a project workflow file, e.g. /repo/.bb/workflows/x.js → /repo.
function projectRootOf(path: string): string | null {
  const i = path.indexOf(WF_MARKER);
  return i === -1 ? null : path.slice(0, i);
}

// A project workflow file must sit DIRECTLY in some checkout's .bb/workflows — no nesting/traversal.
function assertProjectWorkflowPath(path: string): void {
  const i = path.indexOf(WF_MARKER);
  if (i === -1 || !path.endsWith(WORKFLOW_EXT)) throw new Error("not a project workflow path");
  if (path.slice(i + WF_MARKER.length).includes("/")) throw new Error("workflow must sit directly in .bb/workflows");
}

// A global (~/.claude/workflows) .js sitting directly in the store dir.
function assertGlobalPath(dir: string, path: string): void {
  if (!path.endsWith(WORKFLOW_EXT)) throw new Error("not a .js workflow file");
  if (path.slice(0, path.lastIndexOf("/")) !== dir.replace(/\/$/, "")) throw new Error("path is not directly inside the global store");
}

// True when already-normalized `absPath` is `root` itself or sits somewhere under it. Named wfIsWithin
// (not isWithin) to avoid colliding with this file's own pre-existing isWithin(root, target) helper,
// whose argument order is reversed.
function wfIsWithin(absPath: string, root: string): boolean {
  return absPath === root || absPath.startsWith(root.endsWith("/") ? root : root + "/");
}

// The server process is GUI-launched: no shell PATH and no BB_CLI in its env, so a bare "bb" spawn
// fails ENOENT. Resolve the bb CLI binary explicitly — BB_CLI if present, else next to the daemon
// executable (…/Contents/MacOS/bb → …/Contents/Resources/app.asar.unpacked/.../host-daemon/dist/bb),
// else via resourcesPath, else fall back to PATH.
export function resolveBbBin(): string {
  if (process.env.BB_CLI && existsSync(process.env.BB_CLI)) return process.env.BB_CLI;
  const candidates: string[] = [];
  if (process.execPath) {
    candidates.push(
      resolve(dirname(process.execPath), "..", "Resources", "app.asar.unpacked", "node_modules", "bb-app", "host-daemon", "dist", "bb"),
    );
  }
  const resourcesPath = (process as unknown as { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    candidates.push(join(resourcesPath, "app.asar.unpacked", "node_modules", "bb-app", "host-daemon", "dist", "bb"));
  }
  return candidates.find((p) => existsSync(p)) ?? "bb";
}

// `bb workflows run` prints JSON `{ "runId": "wfr_…" }`; fall back to scanning for a wfr_/wf_ token
// when the output is not clean JSON (e.g. warnings prepended).
export function extractRunId(text: string): string | null {
  try {
    const parsed = JSON.parse(text.trim());
    if (parsed && typeof parsed.runId === "string") return parsed.runId;
  } catch {
    // not clean JSON → fall through to a token scan
  }
  const m = text.match(/\bwfr?_[a-z0-9-]+/i);
  return m ? m[0] : null;
}

// Which agents/ directory an agent was discovered in — mirrors rpcContract.wfAgents' output `scope`.
type AgentScope = "user" | "project" | "plugin";

// listPaths, but a missing directory (throw) yields [] instead of failing the caller.
async function listPathsSafe(bb: BbPluginApi, args: { hostId?: string; path: string }): Promise<string[]> {
  try {
    const res = await bb.sdk.files.listPaths({ ...args, includeFiles: true, includeDirectories: false });
    return res.paths.map((p) => p.path);
  } catch {
    return [];
  }
}

// Bare agent names from top-level (no "/") *.md files in a single agents dir.
function bareAgentNames(paths: string[]): string[] {
  return paths.filter((p) => !p.includes("/") && p.endsWith(".md")).map((p) => p.slice(0, -".md".length));
}

// Pull `model:`, `effort:`/`reasoningLevel:`, `description:`, and `tools:` out of an agent .md's
// frontmatter — the simple `key: value` block between the first pair of `---` lines. Missing/malformed
// frontmatter → "" for the scalars, [] for tools.
//
// `tools` supports both Claude Code agent .md syntaxes: an inline comma-separated string
// ("tools: Read, Grep, Glob") and a YAML list on the following indented "- Item" lines.
export function parseAgentFrontmatter(content: string): { model: string; effort: string; description: string; tools: string[] } {
  const lines = content.split("\n");
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== "---") continue;
    if (start === -1) start = i;
    else {
      end = i;
      break;
    }
  }
  let model = "";
  let effort = "";
  let description = "";
  let tools: string[] = [];
  if (start !== -1 && end !== -1) {
    const body = lines.slice(start + 1, end);
    for (let i = 0; i < body.length; i++) {
      const m = body[i].match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (!m) continue;
      const key = m[1].trim();
      const value = m[2].trim().replace(/^["']|["']$/g, "");
      if (key === "model") model = value;
      else if (key === "effort" || key === "reasoningLevel") effort = value;
      else if (key === "description") description = value;
      else if (key === "tools") {
        if (value) {
          tools = value
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
        } else {
          // Empty inline value → a YAML list follows on subsequent "- Item" lines.
          let j = i + 1;
          const items: string[] = [];
          while (j < body.length) {
            const listItem = body[j].match(/^\s*-\s*(.+?)\s*$/);
            if (!listItem) break;
            const item = listItem[1].trim();
            if (item) items.push(item);
            j++;
          }
          tools = items;
          i = j - 1; // resume scanning after the consumed list lines
        }
      }
    }
  }
  return { model, effort, description, tools };
}

// A candidate plugin-dir segment that is really a version tag ("1.0.0", "v2") or a content hash
// ("5e821f406d57") rather than the plugin's own name — skip it and step up one more segment.
const VERSION_LIKE = /^v?\d/;
const HASH_LIKE = /^[0-9a-f]{8,}$/;

// `<plugin>:<agent>` for a path (relative to ~/.claude/plugins) that is a *.md file sitting directly
// in an "agents" directory; null for anything else (nested docs, non-md files, etc).
export function pluginAgentName(relPath: string): string | null {
  const segments = relPath.split("/");
  const filename = segments[segments.length - 1];
  if (!filename || !filename.endsWith(".md")) return null;
  const agentsIdx = segments.length - 2;
  if (agentsIdx < 0 || segments[agentsIdx] !== "agents") return null;
  let pluginIdx = agentsIdx - 1;
  if (pluginIdx < 0) return null;
  const candidate = segments[pluginIdx];
  if (VERSION_LIKE.test(candidate) || HASH_LIKE.test(candidate)) {
    pluginIdx -= 1;
    if (pluginIdx < 0) return null;
  }
  const plugin = segments[pluginIdx];
  return `${plugin}:${filename.slice(0, -".md".length)}`;
}

// Short readable name for a resolved ref: a SKILL.md's parent directory name (e.g. "foo" for
// ".../skills/foo/SKILL.md"), else the file's own basename. Not used by any transferred wf*
// procedure today (agentRefs stayed behind in workflow-composer) — kept + tested because it is
// small, self-contained, and paired 1:1 with agentRefs should that procedure be ported later.
export function agentRefLabel(absPath: string): string {
  const segs = absPath.split("/");
  const filename = segs[segs.length - 1] ?? absPath;
  if (filename === "SKILL.md" && segs.length >= 2) return segs[segs.length - 2];
  return filename;
}

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
  personalAgentsDir: string;
  projectAgentsDir: string | null;
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
  const personalAgentsDir = join(home, ".claude", "agents");

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
      personalAgentsDir,
      projectAgentsDir: null,
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
      personalAgentsDir,
      projectAgentsDir: join(projectClaude, "agents"),
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

/**
 * Раскрывает путь файла из команды хука в абсолютный: плейсхолдеры Claude Code
 * (`$CLAUDE_PROJECT_DIR`, `$CLAUDE_CONFIG_DIR`), `$HOME`, `~` и относительный
 * путь (от корня проекта — с ним Claude Code и запускает хук). Возвращает null,
 * если плейсхолдер не разрешить (нет корня проекта, чужая переменная): показать
 * файл можно только в границах области.
 */
function expandHookFilePath(raw: string, area: Area): string | null {
  let path = raw
    .replace(/\$\{?CLAUDE_CONFIG_DIR\}?/g, area.claudeHome)
    .replace(/\$\{?CLAUDE_PROJECT_DIR\}?/g, area.projectRoot ?? "\0")
    .replace(/\$\{?HOME\}?/g, homedir());
  if (path.includes("\0")) return null; // нужен корень проекта, а его нет
  path = expandTilde(path);
  if (path.startsWith("$")) return null; // осталась незнакомая переменная
  if (!path.startsWith("/")) {
    if (!area.projectRoot) return null;
    path = join(area.projectRoot, path);
  }
  return path;
}

/** Хук как JSON, каким он лежит в `settings.json` — для показа определения. */
function hookDefinitionJson(hook: sd.HookEntry): string {
  const group = {
    ...(hook.matcher ? { matcher: hook.matcher } : {}),
    hooks: [{ type: "command", command: hook.command }],
  };
  return JSON.stringify({ [hook.event]: [group] }, null, 2);
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

/** Ключ kv-хранилища выключенных хуков файла настроек по его пути. */
function disabledHooksKey(path: string): string {
  return `disabledHooks:${path}`;
}

/** Идентичность хука для тумблера/kv: событие, matcher и команда совпадают. */
function sameHook(a: sd.HookEntry, b: sd.HookEntry): boolean {
  return (
    a.event === b.event &&
    (a.matcher ?? null) === (b.matcher ?? null) &&
    a.command === b.command
  );
}

/**
 * Подпись файла, найденного по @-импорту. Обычно последний сегмент пути, но
 * для `SKILL.md` — «<навык>/SKILL.md» (иначе импорты разных навыков схлопнутся
 * в одинаковую подпись «SKILL.md»).
 */
function labelForImport(path: string): string {
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const last = segments[segments.length - 1] ?? path;
  if (last === "SKILL.md" && segments.length >= 2) {
    return `${segments[segments.length - 2]}/SKILL.md`;
  }
  return last;
}

/**
 * Имя навыка из пути к его `SKILL.md`, относительного каталога навыков — та же
 * форма, что и `collectSkillNames` в `src/catalog.ts` (см. его комментарий про
 * `synced/`). `null`, если путь не ведёт к `SKILL.md` напрямую внутри навыка.
 */
function skillTargetName(relPath: string): string | null {
  const segments = relPath.split("/").filter((segment) => segment.length > 0);
  if (segments[segments.length - 1] !== "SKILL.md") return null;
  if (segments[0] === "synced" && segments.length === 3) return segments[1];
  if (segments.length === 2) return segments[0];
  return null;
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

  // Чем открывать реальный файл (навык, агент, документ, ссылка, файл хука) —
  // одна настройка на плагин, читается фронтом живьём через useSettings.
  //   md-opener — во встроенной колонке редактором Kasimov (MdDocView);
  //   builtin    — во встроенной колонке штатным MarkdownEditor + таблицей полей;
  //   host       — делегировать хостовой вкладке bb (прежнее поведение def088e).
  // Отменяет решение claude-config-delegate-file-open: выбор вместо хардкода
  // (memory/decisions/claude-config-opener-setting.md).
  // Настройки Kasimov (кегли/отступы/цвета/шрифты + флаги) объявлены единой
  // таблицей в src/kasimov-settings; здесь только домешиваем их к настройкам
  // плагина рядом с fileOpener. Фронт читает их через useSettings и применяет к
  // колонке-редактору (ColumnMdDocView).
  //
  // Пресеты по умолчанию — «под родной bb-вьюер», те же, что у MD Opener: оба
  // рендерят Kasimov через один и тот же MdDocView/md-doc-view.css (было
  // хардкодом там, см. memory/decisions/kasimov-opener-css-uses-token-defaults.md)
  // — владелец явно попросил одинаковый вид у обоих потребителей.
  // (doc-editor.css в этом плагине — про другой редактор, packages/md-editor
  // с классом cc-doc-mde; к Kasimov отношения не имеет.)
  bb.settings.define({
    fileOpener: {
      type: "select",
      label: "Чем открывать файлы",
      options: ["md-opener", "builtin", "host"],
      default: "md-opener",
    },
    ...buildDescriptors(NATIVE_VIEWER_TOKEN_DEFAULTS),
  });

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

  // Пути файлов внутри каталога (относительно него): каталоги навыков и агентов.
  async function listDirFiles(
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

  /** Хуки, выключенные тумблером для файла настроек по его пути (или []). */
  async function readDisabledHooks(path: string): Promise<sd.HookEntry[]> {
    return (await bb.storage.kv.get<sd.HookEntry[]>(disabledHooksKey(path))) ?? [];
  }

  /** Читает и разбирает файл настроек; SettingsParseError превращает в сообщение. */
  async function readParsedDoc(
    path: string,
    hostId: string | undefined,
  ): Promise<{ doc: sd.SettingsDoc; sha256: string | null } | { error: string }> {
    const { text, sha256 } = await readFile(path, hostId);
    try {
      return { doc: sd.parse(text), sha256 };
    } catch (error) {
      if (error instanceof SettingsParseError) return { error: error.message };
      throw error;
    }
  }

  /**
   * Как правка редактируемого файла области (см. `applyEdit` ниже), но для
   * произвольного файла уровня: хук может жить не в `editedPath`. Свежее чтение
   * прямо перед записью даёт ту же CAS-защиту от параллельной сессии Claude Code.
   */
  async function applyEditToPath(
    path: string,
    hostId: string | undefined,
    edit: (doc: sd.SettingsDoc) => sd.SettingsDoc,
  ): Promise<{ outcome: "ok" | "conflict" | "parse-error"; message: string | null }> {
    const parsed = await readParsedDoc(path, hostId);
    if ("error" in parsed) return { outcome: "parse-error", message: parsed.error };

    const next = sd.serialize(edit(parsed.doc));
    const written = await bb.sdk.files.write({
      path,
      hostId,
      content: next,
      expectedSha256: parsed.sha256 ?? null,
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

  // --- workflow-конструктор: сием и обработчики (перенос) ----------------
  // Инлайн вместо фабрики createPlugin/WorkflowDeps исходного плагина: этому
  // серверу фабрика с инъекцией не нужна (тесты — на чистых функциях выше),
  // а сами обработчики регистрируются в общий `bb.rpc.register` ниже.

  const wfHome = homedir();
  const wfGlobalDir = joinPath(wfHome, ".claude", "workflows");
  const wfBbBin = resolveBbBin();

  function runBbCli(args: string[], opts?: { cwd?: string }): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolvePromise) => {
      const child = spawn(wfBbBin, args, { cwd: opts?.cwd, env: process.env });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("error", (err) => resolvePromise({ code: -1, stdout, stderr: stderr + String(err) }));
      child.on("close", (code) => resolvePromise({ code: code ?? -1, stdout, stderr }));
    });
  }

  function gitWorktrees(root: string): Promise<string[]> {
    return new Promise((resolvePromise) => {
      const child = spawn("git", ["-C", root, "worktree", "list", "--porcelain"], { env: process.env });
      let out = "";
      child.stdout.on("data", (d) => (out += d.toString()));
      child.on("error", () => resolvePromise([]));
      child.on("close", () =>
        resolvePromise(
          out
            .split("\n")
            .filter((l) => l.startsWith("worktree "))
            .map((l) => l.slice("worktree ".length).trim())
            .filter(Boolean),
        ),
      );
    });
  }

  // The project's default source (checkout root + its host).
  async function projectSource(projectId: string | null): Promise<{ hostId: string; path: string }> {
    if (!projectId) throw new Error("project store needs a project in view");
    const project = await bb.sdk.projects.get({ projectId });
    const source = project.sources.find((s) => s.isDefault) ?? project.sources[0];
    if (!source) throw new Error("project has no source path");
    return { hostId: source.hostId, path: source.path };
  }

  // Scan one directory for top-level workflow .js files, reading each to recover its description/tree.
  async function wfScanDir(hostId: string | undefined, dir: string, store: WfStore) {
    let entries: { path: string }[] = [];
    try {
      const res = await bb.sdk.files.listPaths({ hostId, path: dir, includeFiles: true, includeDirectories: false });
      entries = res.paths;
    } catch {
      return []; // dir does not exist
    }
    const items = [];
    for (const entry of entries) {
      if (entry.path.includes("/") || !entry.path.endsWith(WORKFLOW_EXT)) continue; // top-level .js only
      const abs = joinPath(dir, entry.path);
      let description = "";
      let hasTree = false;
      try {
        const file = await bb.sdk.files.read({ hostId, path: abs });
        const tree = parseWorkflow(file.content);
        hasTree = tree !== null;
        // A composer-written file carries its description in the mirrored tree; a hand-written one has no
        // mirror, so fall back to its `export const meta` description rather than showing a blank row.
        description = tree?.description ?? readMetaDescription(file.content);
      } catch {
        // unreadable → list it minimally
      }
      items.push({ name: baseName(entry.path), path: abs, store, description, hasTree });
    }
    return items;
  }

  // Project workflows live in EVERY checkout of the project (main source + its git worktrees), so union
  // across them, deduped by name (first checkout wins).
  async function wfListProjectStore(projectId: string | null) {
    let src: { hostId: string; path: string };
    try {
      src = await projectSource(projectId);
    } catch {
      return [];
    }
    const worktrees = await gitWorktrees(src.path).catch(() => []);
    const roots = [...new Set([src.path, ...worktrees])];
    const byName = new Map<string, Awaited<ReturnType<typeof wfScanDir>>[number]>();
    for (const root of roots) {
      for (const item of await wfScanDir(src.hostId, joinPath(root, ".bb", "workflows"), "project")) {
        if (!byName.has(item.name)) byName.set(item.name, item);
      }
    }
    return [...byName.values()];
  }

  // hostId + working dir for an already-existing file (read/remove/validate/run).
  async function wfResolveFile(store: WfStore, projectId: string | null, path: string): Promise<{ hostId: string | undefined; cwd: string | undefined }> {
    if (store === "global") {
      assertGlobalPath(wfGlobalDir, path);
      return { hostId: undefined, cwd: undefined };
    }
    assertProjectWorkflowPath(path);
    const src = await projectSource(projectId);
    return { hostId: src.hostId, cwd: projectRootOf(path) ?? undefined };
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
      const [
        personalSkillPaths,
        projectSkillPaths,
        personalAgentPaths,
        projectAgentPaths,
      ] = await Promise.all([
        listDirFiles(area.personalSkillsDir, area.hostId),
        listDirFiles(area.projectSkillsDir, area.hostId),
        listDirFiles(area.personalAgentsDir, area.hostId),
        listDirFiles(area.projectAgentsDir, area.hostId),
      ]);
      // По ПУТИ файла уровня, не по области: ~/.claude/settings.json общий для
      // всех проектных областей, и disabled-хуки в нём должны быть общими тоже.
      const disabledHooksByLevel = await Promise.all(
        area.levelPaths.map((path) => readDisabledHooks(path)),
      );

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
        personalAgentDir: area.personalAgentsDir,
        projectAgentDir: area.projectAgentsDir,
        personalAgentPaths,
        projectAgentPaths,
        mcpJsonText: mcpJson.text,
        claudeJsonText: claudeJson.text,
        projectRoot: area.projectRoot,
        levelOrigins: [...levelOrigins],
        disabledHooksByLevel,
      });

      // «Вес» строк в токенах: читаем содержимое файлов раздела и оцениваем.
      // Ошибка чтения — tokens=null (в UI подпись просто без веса).
      const tokensOf = async (
        path: string | null,
        hostId: string | undefined,
        rootPath?: string,
      ): Promise<number | null> => {
        if (!path) return null;
        const { text } = await readFile(path, hostId, rootPath);
        return text == null ? null : estimateTokens(text);
      };

      // Имя навыка → путь его SKILL.md (та же раскладка, что в collectSkillNames).
      const skillFileByName = (
        dir: string | null,
        relPaths: string[],
      ): Map<string, string> => {
        const map = new Map<string, string>();
        if (!dir) return map;
        for (const rel of relPaths) {
          const seg = rel.split("/").filter(Boolean);
          if (seg[seg.length - 1] !== "SKILL.md") continue;
          const name =
            seg[0] === "synced" && seg.length === 3
              ? seg[1]
              : seg.length === 2
                ? seg[0]
                : null;
          if (name) map.set(name, join(dir, rel));
        }
        return map;
      };
      const personalSkillFiles = skillFileByName(
        area.personalSkillsDir,
        personalSkillPaths,
      );
      const projectSkillFiles = skillFileByName(
        area.projectSkillsDir,
        projectSkillPaths,
      );

      // Определения коннекторов (JSON) по ключу origin:name — их вес.
      const connectorDefs = new Map<string, string>();
      for (const server of parseMcpJson(mcpJson.text)) {
        connectorDefs.set(
          `mcpjson:${server.name}`,
          JSON.stringify(server.config),
        );
      }
      const claudeServers = parseClaudeJsonServers(
        claudeJson.text,
        area.projectRoot,
      );
      for (const server of claudeServers.user) {
        connectorDefs.set(`user:${server.name}`, JSON.stringify(server.config));
      }
      for (const server of claudeServers.local) {
        connectorDefs.set(`local:${server.name}`, JSON.stringify(server.config));
      }

      const [skills, agents, plugins] = await Promise.all([
        Promise.all(
          view.skills.map(async (skill) => {
            const path = (
              skill.origin === "project" ? projectSkillFiles : personalSkillFiles
            ).get(skill.name);
            return {
              ...skill,
              path: path ?? null,
              tokens: await tokensOf(path ?? null, area.hostId),
            };
          }),
        ),
        Promise.all(
          view.agents.map(async (agent) => ({
            ...agent,
            tokens: await tokensOf(agent.path, area.hostId),
          })),
        ),
        Promise.all(
          view.plugins.map(async (plugin) => {
            if (!plugin.installPath) return { ...plugin, tokens: null };
            const manifest = await readFile(
              join(plugin.installPath, ".claude-plugin", "plugin.json"),
              area.hostId,
              area.claudeHome,
            );
            let readme = "";
            for (const name of ["README.md", "readme.md"]) {
              const { text } = await readFile(
                join(plugin.installPath, name),
                area.hostId,
                area.claudeHome,
              );
              if (text != null) {
                readme = text;
                break;
              }
            }
            const combined = (manifest.text ?? "") + readme;
            return {
              ...plugin,
              tokens: combined.length ? estimateTokens(combined) : null,
            };
          }),
        ),
      ]);
      const connectors = view.connectors.map((connector) => {
        const def = connectorDefs.get(`${connector.origin}:${connector.name}`);
        return { ...connector, tokens: def ? estimateTokens(def) : null };
      });

      return {
        areaLabel: area.label,
        editedFilePath: area.editedPath,
        error: null,
        ...view,
        plugins,
        connectors,
        skills,
        agents,
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
      const notFound = {
        path: "",
        command: null,
        error: "Хук не найден.",
        sha256: null,
        event: null,
        matcher: null,
        definition: null,
        filePath: null,
        fileContent: null,
      };
      const area = await resolveArea(bb, areaId);
      if (!area) {
        return { ...notFound, error: "Область не найдена." };
      }
      // origin → уровень: user/project/local соответствуют порядку levelPaths.
      const levelIndex = { user: 0, project: 1, local: 2 }[origin];
      const path = area.levelPaths[levelIndex];
      if (!path) return notFound;

      const { text, sha256 } = await readFile(path, area.hostId);
      let hook;
      try {
        hook = sd.listHooks(sd.parse(text))[index];
      } catch (error) {
        if (error instanceof SettingsParseError) {
          return { ...notFound, path, error: error.message };
        }
        throw error;
      }
      if (!hook) return { ...notFound, path };

      // Файл, который команда читает или запускает (если опознан и лежит в
      // границах области): плейсхолдеры окружения раскрываем, читаем с confinement.
      let filePath: string | null = null;
      let fileContent: string | null = null;
      const rawFile = extractCommandFile(hook.command);
      if (rawFile) {
        const abs = expandHookFilePath(rawFile, area);
        const match = abs && matchRoot(area, abs);
        if (abs && match) {
          const { text: fileText } = await readFile(abs, match.hostId, match.root);
          if (fileText !== null) {
            filePath = abs;
            fileContent = fileText;
          }
        }
      }

      return {
        path,
        command: hook.command,
        error: null,
        sha256,
        event: hook.event,
        matcher: hook.matcher,
        definition: hookDefinitionJson(hook),
        filePath,
        fileContent,
      };
    },

    async writeHook({ areaId, origin, index, command, expectedSha256 }) {
      const area = await resolveArea(bb, areaId);
      if (!area) {
        return { outcome: "not-found" as const, sha256: null, message: "Область не найдена." };
      }
      const levelIndex = { user: 0, project: 1, local: 2 }[origin];
      const path = area.levelPaths[levelIndex];
      if (!path) {
        return { outcome: "not-found" as const, sha256: null, message: "Уровень не найден." };
      }

      const parsed = await readParsedDoc(path, area.hostId);
      if ("error" in parsed) {
        return { outcome: "denied" as const, sha256: null, message: parsed.error };
      }

      // index вне диапазона — писать нечего: не рапортуем «written» по no-op.
      if (!sd.listHooks(parsed.doc)[index]) {
        return { outcome: "not-found" as const, sha256: null, message: "Хук не найден." };
      }

      const next = sd.setHookCommandAt(parsed.doc, index, command);
      const written = await bb.sdk.files.write({
        path,
        hostId: area.hostId,
        content: sd.serialize(next),
        expectedSha256,
        createParents: true,
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

    async setHookEnabled({
      areaId,
      origin,
      event,
      matcher,
      command,
      enabled,
    }): Promise<WriteOutcome> {
      const area = await resolveArea(bb, areaId);
      if (!area) return { outcome: "not-found", message: "Область не найдена." };
      const levelIndex = { user: 0, project: 1, local: 2 }[origin];
      const path = area.levelPaths[levelIndex];
      if (!path) return { outcome: "not-found", message: "Уровень не найден." };

      const entry: sd.HookEntry = { event, matcher, command };

      if (!enabled) {
        const parsed = await readParsedDoc(path, area.hostId);
        if ("error" in parsed) return { outcome: "parse-error", message: parsed.error };

        const { doc: next, removed } = sd.removeHook(parsed.doc, entry);
        // Уже выключен (или его вообще нет в файле) — идемпотентно, kv не трогаем.
        if (removed === null) return { outcome: "ok", message: null };

        const written = await bb.sdk.files.write({
          path,
          hostId: area.hostId,
          content: sd.serialize(next),
          expectedSha256: parsed.sha256 ?? null,
          createParents: true,
        });
        if (written.outcome === "conflict") {
          return {
            outcome: "conflict",
            message: "Файл изменила другая сессия. Обновите и повторите.",
          };
        }

        const disabled = await readDisabledHooks(path);
        if (!disabled.some((existing) => sameHook(existing, entry))) {
          await bb.storage.kv.set(disabledHooksKey(path), [...disabled, entry]);
        }
        return { outcome: "ok", message: null };
      }

      const disabled = await readDisabledHooks(path);
      if (!disabled.some((existing) => sameHook(existing, entry))) {
        // Нечего восстанавливать — идемпотентно.
        return { outcome: "ok", message: null };
      }

      const written = await applyEditToPath(path, area.hostId, (doc) =>
        sd.addHook(doc, entry),
      );
      if (written.outcome !== "ok") return written;

      const remaining = disabled.filter((existing) => !sameHook(existing, entry));
      if (remaining.length === 0) await bb.storage.kv.delete(disabledHooksKey(path));
      else await bb.storage.kv.set(disabledHooksKey(path), remaining);
      return { outcome: "ok", message: null };
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
      const visited = new Set<string>();
      // В очередь кладём уже прочитанный текст файла — его же разбираем на
      // @-импорты, второй раз с диска не читаем.
      const queue: { path: string; text: string }[] = [];

      for (const candidate of memoryCandidates(area)) {
        visited.add(candidate.path);
        const { text } = await readFile(candidate.path, candidate.hostId);
        if (text === null) continue;
        entries.push({
          id: candidate.id,
          label: candidate.label,
          path: candidate.path,
        });
        queue.push({ path: candidate.path, text });
      }

      // Разбираем @-импорты транзитивно: CLAUDE.md ссылается на навыки, навыки —
      // на свои же файлы. Срез по числу, а не по глубине, — защита от развесистого
      // дерева ссылок, а не только от циклов (их и так режет `visited`).
      const IMPORT_LIMIT = 100;
      let imported = 0;
      while (queue.length > 0 && imported < IMPORT_LIMIT) {
        const from = queue.shift();
        if (!from) break;

        for (const importPath of parseImports(from.text)) {
          if (imported >= IMPORT_LIMIT) {
            bb.log.info("listMemory: срезано по лимиту импортов (100)");
            break;
          }
          const abs = resolveImportPath(from.path, importPath, homedir());
          if (visited.has(abs)) continue;
          visited.add(abs);

          // Вне корней области — пропускаем (та же граница, что и у readDoc).
          const target = matchRoot(area, abs);
          if (!target) continue;

          const { text: importedText } = await readFile(abs, target.hostId, target.root);
          if (importedText === null) continue;

          entries.push({ id: `import:${abs}`, label: labelForImport(abs), path: abs });
          queue.push({ path: abs, text: importedText });
          imported += 1;
        }
      }

      return { entries };
    },

    async listRefTargets({ areaId }) {
      const area = await resolveArea(bb, areaId);
      if (!area) return { targets: [] };

      try {
        const [personalSkillPaths, projectSkillPaths] = await Promise.all([
          listDirFiles(area.personalSkillsDir, area.hostId),
          listDirFiles(area.projectSkillsDir, area.hostId),
        ]);

        const targets: { value: string; label: string; kind: "skill" | "memory" }[] = [];
        const seen = new Set<string>();
        const push = (value: string, label: string, kind: "skill" | "memory") => {
          if (seen.has(value)) return;
          seen.add(value);
          targets.push({ value, label, kind });
        };

        // Личные навыки: путь уже относителен `~/.claude/skills`, поэтому
        // вставляемый импорт — просто `~/.claude/skills/<этот же путь>`.
        for (const relPath of personalSkillPaths) {
          const name = skillTargetName(relPath);
          if (!name) continue;
          push(`~/.claude/skills/${relPath}`, name, "skill");
        }
        // Проектные навыки: вставляем абсолютный путь (нет `~`-алиаса для проекта).
        if (area.projectSkillsDir) {
          for (const relPath of projectSkillPaths) {
            const name = skillTargetName(relPath);
            if (!name) continue;
            push(join(area.projectSkillsDir, relPath), name, "skill");
          }
        }

        for (const candidate of memoryCandidates(area)) {
          const { text } = await readFile(candidate.path, candidate.hostId);
          if (text !== null) push(candidate.path, candidate.label, "memory");
        }

        return { targets };
      } catch {
        return { targets: [] };
      }
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

    async resolveOpenTarget({ areaId, path }) {
      const area = await resolveArea(bb, areaId);
      if (!area) return { hostId: null, error: "Область не найдена." };
      const abs = expandTilde(path);
      const match = matchRoot(area, abs);
      if (!match) return { hostId: null, error: "Путь вне доступных папок." };
      // Проектный корень несёт свой хост; личный уровень (~/.claude) лежит на
      // локальном хосте сервера — его id берём из primaryHostId.
      if (match.hostId) return { hostId: match.hostId, error: null };
      const { primaryHostId } = await bb.sdk.system.config();
      if (!primaryHostId) {
        return { hostId: null, error: "Основной хост не определён." };
      }
      return { hostId: primaryHostId, error: null };
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

    createSkill({ areaId, name }) {
      // Навык — папка `<slug>/SKILL.md`; в проекте кладём в проектный каталог,
      // глобально — в личный. Каталог создаётся вместе с файлом (createParents).
      return createFile(areaId, name, (area, slug) => {
        const dir = area.projectSkillsDir ?? area.personalSkillsDir;
        return { path: join(dir, slug, "SKILL.md"), content: skillTemplate(slug) };
      });
    },

    createAgent({ areaId, name }) {
      // Агент — одиночный файл `<slug>.md` в каталоге агентов области.
      return createFile(areaId, name, (area, slug) => {
        const dir = area.projectAgentsDir ?? area.personalAgentsDir;
        return { path: join(dir, `${slug}.md`), content: agentTemplate(slug) };
      });
    },

    // ---- workflow-конструктор (перенос bb-plugin-workflow-composer) ----

    async wfList({ projectId }) {
      const [project, global] = await Promise.all([wfListProjectStore(projectId), wfScanDir(undefined, wfGlobalDir, "global")]);
      return { items: [...project, ...global] };
    },

    async wfRead({ projectId, store, path }) {
      const { hostId } = await wfResolveFile(store, projectId, path);
      const file = await bb.sdk.files.read({ hostId, path });
      return { source: file.content, tree: parseWorkflow(file.content) };
    },

    async wfSave({ projectId, store, name, source }) {
      const slug = String(name).trim();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error("name must be lowercase kebab-case");
      let hostId: string | undefined;
      let dir: string;
      if (store === "global") {
        hostId = undefined;
        dir = wfGlobalDir;
      } else {
        const src = await projectSource(projectId);
        hostId = src.hostId;
        dir = joinPath(src.path, ".bb", "workflows"); // new project workflows land in the default checkout
      }
      const path = joinPath(dir, slug + WORKFLOW_EXT);
      await bb.sdk.files.write({ hostId, path, content: source, createParents: true });
      return { path };
    },

    async wfRemove({ projectId, store, path }) {
      const { hostId } = await wfResolveFile(store, projectId, path);
      await bb.sdk.files.remove({ hostId, path });
      return { ok: true };
    },

    async wfValidate({ projectId, store, path }) {
      const { cwd } = await wfResolveFile(store, projectId, path);
      const res = await runBbCli(["workflows", "validate", "--file", path], { cwd });
      return { ok: res.code === 0, output: (res.stdout + res.stderr).trim() };
    },

    async wfRun({ projectId, store, path }) {
      const { cwd } = await wfResolveFile(store, projectId, path);
      const res = await runBbCli(["workflows", "run", "--file", path], { cwd });
      return { ok: res.code === 0, runId: extractRunId(res.stdout + res.stderr), output: (res.stdout + res.stderr).trim() };
    },

    async wfStatus({ runId }) {
      const res = await runBbCli(["workflows", "status", runId]);
      return { output: (res.stdout + res.stderr).trim() };
    },

    async wfProjects() {
      const list = await bb.sdk.projects.list();
      return list.map((p) => ({ id: p.id, name: p.name }));
    },

    async wfAgents({ projectId }) {
      // value → its frontmatter-derived model/effort/provider/description + its file path. A Map (not a
      // Set) so each value carries its own detail; first source to discover a value wins, matching the
      // old Set's de-dup semantics.
      const found = new Map<
        string,
        { model: string; effort: string; provider: string; description: string; path: string; tools: string[]; scope: AgentScope }
      >();

      // Every agent source scanned here sits under a `.claude` directory, so provider is always
      // "claude-code" — the day a non-.claude source is added, that source computes its own provider.
      // `scope` records which of the three source directories this agent came from, so the client can
      // route writeAgent's overwrite back to the same source (and disable Override for "plugin").
      const addAgent = async (value: string, hostId: string | undefined, absPath: string, scope: AgentScope) => {
        if (found.has(value)) return;
        let model = "";
        let effort = "";
        let description = "";
        let tools: string[] = [];
        try {
          const file = await bb.sdk.files.read({ hostId, path: absPath });
          ({ model, effort, description, tools } = parseAgentFrontmatter(file.content));
        } catch {
          // unreadable → still list it, with blank model/effort/description/tools
        }
        found.set(value, { model, effort, provider: "claude-code", description, path: absPath, tools, scope });
      };

      const userDir = joinPath(wfHome, ".claude", "agents");
      const userPaths = await listPathsSafe(bb, { path: userDir });
      for (const name of bareAgentNames(userPaths)) await addAgent(name, undefined, joinPath(userDir, name + ".md"), "user");

      if (projectId !== null) {
        try {
          const src = await projectSource(projectId);
          const projectDir = joinPath(src.path, ".claude", "agents");
          const projectPaths = await listPathsSafe(bb, { hostId: src.hostId, path: projectDir });
          for (const name of bareAgentNames(projectPaths))
            await addAgent(name, src.hostId, joinPath(projectDir, name + ".md"), "project");
        } catch {
          // no resolvable project source → project agents skipped
        }
      }

      const pluginsDir = joinPath(wfHome, ".claude", "plugins");
      const pluginPaths = await listPathsSafe(bb, { path: pluginsDir });
      for (const relPath of pluginPaths) {
        const name = pluginAgentName(relPath);
        if (name) await addAgent(name, undefined, joinPath(pluginsDir, relPath), "plugin");
      }

      const agents = [...found.entries()]
        .map(([value, detail]) => ({ value, ...detail }))
        .sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
      return { agents };
    },

    async wfProviderCatalog() {
      const providers = await bb.sdk.providers.list();
      return Promise.all(
        providers.map(async (p) => {
          let models: { id: string; efforts: string[] }[] = [];
          try {
            const res = await bb.sdk.providers.models({ providerId: p.id });
            models = res.models.map((m) => ({ id: m.id, efforts: m.supportedReasoningEfforts.map((e) => e.reasoningEffort) }));
          } catch {
            // one provider's catalog failing shouldn't blank out the others
          }
          return { id: p.id, name: p.displayName || p.id, models };
        }),
      );
    },

    async wfWriteAgent({ projectId, scope, name, content, overwrite }) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error("agent name must be lowercase kebab-case");

      let hostId: string | undefined;
      let dir: string;
      if (scope === "user") {
        hostId = undefined;
        dir = joinPath(wfHome, ".claude", "agents");
      } else {
        const src = await projectSource(projectId);
        hostId = src.hostId;
        dir = joinPath(src.path, ".claude", "agents");
      }

      const path = joinPath(dir, name + ".md");
      // FENCING: even though the kebab-case check above already rejects "/" and "..", normalize + confine
      // explicitly (matching the agentRefs style) so this guard doesn't silently rot if that check ever
      // loosens.
      if (!wfIsWithin(posixPath.normalize(path), posixPath.normalize(dir))) throw new Error("agent path escapes its scope directory");

      if (!overwrite) {
        let exists = true;
        try {
          await bb.sdk.files.read({ hostId, path });
        } catch {
          exists = false;
        }
        if (exists) throw new Error("agent already exists");
      }

      await bb.sdk.files.write({ hostId, path, content, createParents: true });
      return { path };
    },
  });

  /**
   * Создаёт новый файл конфигурации (навык или агент) из сырого имени. `plan` по
   * области и уже нормализованному слагу даёт путь и содержимое. Запись —
   * create-only (expectedSha256 null): существующий файл не перезаписываем, а
   * возвращаем `exists`, чтобы панель не затёрла одноимённый навык.
   */
  async function createFile(
    areaId: string,
    rawName: string,
    plan: (area: Area, slug: string) => { path: string; content: string },
  ): Promise<{
    outcome: "created" | "exists" | "invalid" | "not-found";
    path: string | null;
    message: string | null;
  }> {
    if (!isValidName(rawName)) {
      return {
        outcome: "invalid",
        path: null,
        message: "Имя должно содержать латинские буквы или цифры.",
      };
    }
    const area = await resolveArea(bb, areaId);
    if (!area) {
      return { outcome: "not-found", path: null, message: "Область не найдена." };
    }

    const { path, content } = plan(area, slugifyName(rawName));
    const written = await bb.sdk.files.write({
      path,
      hostId: area.hostId,
      content,
      expectedSha256: null,
      createParents: true,
    });
    if (written.outcome === "conflict") {
      return { outcome: "exists", path, message: "Такой уже существует." };
    }
    return { outcome: "created", path, message: null };
  }

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
    agents: [],
    hooks: [],
    toolSearch: { enabled: true as const, mode: "auto" as const, dimmed: false },
  };
}
