// bb-plugin-claude-config — панель: выбор области сверху и секции (хуки,
// плагины, коннекторы, навыки, агенты, подгрузка инструментов). Данные и запись
// — через RPC к server.ts; здесь только показ и переключение. Навыки и агенты
// можно создать кнопкой в шапке секции (диалог имени → createSkill/createAgent).
// Коннекторы .mcp.json
// переключаются тумблером; user/local и хуки — только просмотр (хук кликабелен,
// открывает своё содержимое во второй колонке).
//
// SKILL.md выбранного навыка (и любой открытый документ) показывается второй
// колонкой внутри самой панели — компонентом DocTab по тому же `subPath`
// маршрута (там и область, и имя), который панель уже получает. Раньше это была
// фиксированная вкладка в правой хостовой панели (experimental_fixedTabs), но в
// bb 0.40.0 navPanel с этой опцией не монтируется и пункт пропадает из сайдбара
// (см. задачу BP-53), поэтому содержимое перенесено в колонку.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import {
  definePluginApp,
  Markdown,
  useBbNavigate,
  useRpc,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { AreaConfig, rpcContract, WriteOutcome } from "./server";
import { MdDocView } from "./packages/md-doc-view";
import type { LoadedDoc, SaveResult } from "./packages/md-doc-view";
import {
  parseKasimovSettings,
  kasimovCssVars,
  kasimovFlags,
} from "./packages/md-doc-view";
import { isHostOpen, normalizeOpener } from "./src/open-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { isValidName, slugifyName } from "./src/scaffold";
import {
  fieldsFromJson,
  type FrontmatterEntry,
  parseFrontmatter,
  serializeFrontmatter,
  setFieldValue,
} from "./src/frontmatter";
import { MarkdownEditor } from "./packages/md-editor/react";
import { formatWeight } from "./src/weight";
import {
  fileRefFromCode,
  isInTabLink,
  parseHref,
  resolveRelative,
} from "./packages/link-navigation/resolve";
import {
  ResizeHandle,
  HorizontalResizeHandle,
  useResizableWidth,
  useResizableHeight,
} from "./packages/resizable-pane/react";
import { ProjectSwitcher } from "./packages/project-switcher/react";
import { rankCandidates } from "./src/suggest";
import { extractCommandFile } from "./src/hook-script";
import "./doc-editor.css";
// Раздел «Workflows» — конструктор workflow, встроенный в панель как ещё один
// раздел рейки (см. WorkflowsView ниже). Ядро (модель дерева, чистые операции
// над ним, module-level store) и сам конструктор уже реализованы соседними
// группами; здесь — только интеграция: RPC-обвязка на wf*-процедуры server.ts
// и многоколоночная раскладка внутри панели.
import { editorStore, engineForStore, type StoreKind, type Identity } from "./src/workflow/store";
import { compile, blankTree, type Engine, type Tree, type Agent, type Phase, type Step } from "./src/workflow/workflow-model";
import { applyTemplate, setAgentField, nodeAt, type OutlinePath } from "./src/workflow/outline-ops";
import { agentsMissingTemplate } from "./src/workflow/validity";
import {
  OutlineEditor,
  AgentDetails,
  type AgentOption,
  type ProviderCatalogEntry,
} from "./components/workflow/outline-editor";

const PANEL_PATH = "claude-config";

type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;

// Разделы средней колонки — выбираются из рейки, определяют, что показать.
type SectionId =
  | "hooks"
  | "plugins"
  | "connectors"
  | "skills"
  | "agents"
  | "toolSearch"
  | "workflows";

// Режим включённого навыка и цель записи (включая off) — как в контракте.
type SkillMode = "on" | "name-only" | "user-invocable-only";
type SkillTarget = SkillMode | "off";
type ToolSearchModeOn = "on" | "auto";
type ToolSearchTarget = ToolSearchModeOn | "off";

// Режимы включённого навыка для выпадающего списка (порядок — от полного к узкому).
const SKILL_MODE_OPTIONS: { value: SkillMode; label: string }[] = [
  { value: "on", label: "Полностью" },
  { value: "name-only", label: "Только название" },
  { value: "user-invocable-only", label: "Через слэш" },
];

// Режимы включённой подгрузки инструментов.
const TOOL_SEARCH_MODE_OPTIONS: { value: ToolSearchModeOn; label: string }[] = [
  { value: "auto", label: "Автоматически" },
  { value: "on", label: "Всегда" },
];

// Откуда объявлен коннектор — подпись под именем.
const CONNECTOR_ORIGIN_LABEL: Record<ConnectorOrigin, string> = {
  mcpjson: ".mcp.json",
  user: "глобальный",
  local: "локальный",
};

// С какого уровня настроек пришёл хук.
const HOOK_ORIGIN_LABEL: Record<"user" | "project" | "local", string> = {
  user: "глобальный",
  project: "проектный",
  local: "локальный",
};

function connectorSubtitle(origin: ConnectorOrigin, transport: string): string {
  const label = CONNECTOR_ORIGIN_LABEL[origin];
  return transport ? `${label} · ${transport}` : label;
}

// Что открыто в правой вкладке, живёт в subPath. Навык — `skill/<area>/<name>`
// (сервер сам находит его SKILL.md). Любой файл по абсолютному пути (README
// плагина, файл памяти) — `doc/<area>/<b64>`, где путь закодирован base64url,
// чтобы его слэши не спутались с разделителем сегментов.
type ConnectorOrigin = "mcpjson" | "user" | "local";
type HookOrigin = "user" | "project" | "local";

type DocTarget =
  | { kind: "skill"; areaId: string; name: string }
  | { kind: "plugin"; areaId: string; key: string }
  | { kind: "connector"; areaId: string; name: string; origin: ConnectorOrigin }
  | {
      kind: "hook";
      areaId: string;
      origin: HookOrigin;
      index: number;
      event: string;
    }
  | { kind: "doc"; areaId: string; path: string };

function encodePath(path: string): string {
  return btoa(path).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodePath(encoded: string): string {
  const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  return atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
}

function skillSubPath(areaId: string, name: string): string {
  return `skill/${areaId}/${name}`;
}
function pluginSubPath(areaId: string, key: string): string {
  return `plugin/${areaId}/${encodePath(key)}`;
}
function connectorSubPath(
  areaId: string,
  origin: ConnectorOrigin,
  name: string,
): string {
  return `connector/${areaId}/${origin}/${encodePath(name)}`;
}
function hookSubPath(
  areaId: string,
  origin: HookOrigin,
  index: number,
  event: string,
): string {
  return `hook/${areaId}/${origin}/${index}/${encodePath(event)}`;
}
function docSubPath(areaId: string, path: string): string {
  return `doc/${areaId}/${encodePath(path)}`;
}
function parseDocSubPath(subPath: string): DocTarget | null {
  const seg = subPath.split("/").filter(Boolean);
  if (seg[0] === "skill" && seg[1] && seg[2]) {
    return { kind: "skill", areaId: seg[1], name: seg[2] };
  }
  if (seg[0] === "plugin" && seg[1] && seg[2]) {
    return { kind: "plugin", areaId: seg[1], key: decodePath(seg[2]) };
  }
  if (seg[0] === "connector" && seg[1] && seg[2] && seg[3]) {
    return {
      kind: "connector",
      areaId: seg[1],
      origin: seg[2] as ConnectorOrigin,
      name: decodePath(seg[3]),
    };
  }
  if (seg[0] === "hook" && seg[1] && seg[2] && seg[3] && seg[4]) {
    return {
      kind: "hook",
      areaId: seg[1],
      origin: seg[2] as HookOrigin,
      index: Number(seg[3]),
      event: decodePath(seg[4]),
    };
  }
  if (seg[0] === "doc" && seg[1] && seg[2]) {
    return { kind: "doc", areaId: seg[1], path: decodePath(seg[2]) };
  }
  return null;
}

// Открыть реальный файл по настройке `fileOpener` (memory/decisions/
// claude-config-opener-setting.md). `md-opener`/`builtin` — во встроенной колонке
// (DocTab по subPath, редактор выбирает сам DocTab). `host` — делегировать
// хостовой вкладке bb: сервер по области и пути отдаёт хост, тот открывает файл
// опенером формата. Синтезированные представления (плагин, коннектор, команда
// хука) — не файлы, идут не сюда.
function useOpenFile(areaId: string): (path: string) => Promise<void> {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const settings = useSettings();
  const fileOpener = (settings.values as { fileOpener?: unknown } | undefined)
    ?.fileOpener;
  return async (path: string) => {
    if (!isHostOpen(fileOpener)) {
      navigate.toPluginPanel(PANEL_PATH, {
        subPath: docSubPath(areaId, path),
      });
      return;
    }
    const { hostId, error } = await rpc.call("resolveOpenTarget", {
      areaId,
      path,
    });
    if (!hostId) {
      toast.error(error ?? "Не удалось открыть файл.");
      return;
    }
    const opened = navigate.experimental_openFilePreview({
      target: { kind: "host", hostId, path },
      location: null,
    });
    if (!opened) toast.error("Хост отклонил открытие файла.");
  };
}

// Встроенная колонка в режиме `md-opener`: тот же MdDocView, что и слот
// MD Opener, но поверх RPC самой панели. Любой файл (md и не-md) правится сырым
// текстом; ссылки резолвятся как в остальной панели (относительно документа, `~`
// и `/` — как есть, границы проверит сервер).
function ColumnMdDocView({
  areaId,
  initialPath,
  leading,
  editButton,
}: {
  areaId: string;
  initialPath: string;
  // Прокидываются в MdDocView как есть — хозяин вкладки решает, что показать в
  // начале общей шапки и чем заменить дефолтную кнопку «Редактировать» (см. md-doc-view).
  leading?: ReactNode;
  editButton?: (onClick: () => void) => ReactNode;
}) {
  const rpc = useRpc<typeof rpcContract>();
  // Вид и флаги Kasimov — из настроек плагина (kasimov*). parse тотален: пока
  // useSettings грузится (values === undefined) — дефолты, совпадающие с kasimov.css.
  const settings = parseKasimovSettings(useSettings().values);
  const vars = kasimovCssVars(settings);
  const flags = kasimovFlags(settings);
  const load = async (path: string): Promise<LoadedDoc> => {
    const res = await rpc.call("readDoc", { areaId, path });
    return {
      path: res.path,
      content: res.content,
      sha256: res.sha256,
      error: res.error,
    };
  };
  const save = (
    path: string,
    content: string,
    expectedSha256: string | null,
  ): Promise<SaveResult> =>
    rpc.call("writeDoc", { areaId, path, content, expectedSha256 });
  const resolveLinkTarget = (href: string, fromPath: string): string | null => {
    if (!isInTabLink(href) && !href.startsWith("~/")) return null;
    const path = parseHref(href).path;
    return path.startsWith("~/") || path.startsWith("/")
      ? path
      : resolveRelative(fromPath, path);
  };
  return (
    <MdDocView
      key={initialPath}
      initialPath={initialPath}
      load={load}
      save={save}
      resolveLinkTarget={resolveLinkTarget}
      vars={vars}
      followLinks={flags.followLinks}
      frontmatter={flags.frontmatter}
      leading={leading}
      editButton={editButton}
    />
  );
}

// Markdown-файлы рендерим как есть; прочие (например plugin.json) — кодовым
// блоком с подсветкой по расширению, чтобы читалось, а не разъезжалось.
// Вторая строка элемента списка: вес в токенах впереди, затем остальное
// (происхождение, версия, транспорт). Нет веса — только остальное; нет
// остального — только вес.
function secondLine(tokens: number | null, rest: string): string {
  const weight = tokens != null ? formatWeight(tokens) : "";
  if (weight && rest) return `${weight} · ${rest}`;
  return weight || rest;
}

function asMarkdown(path: string, content: string): string {
  if (/\.(md|markdown)$/i.test(path)) return content;
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const lang = /^[a-z0-9]+$/.test(ext) ? ext : "";
  return `\`\`\`${lang}\n${content}\n\`\`\``;
}

/**
 * Показывает команду хука, сделав в ней токен пути к файлу кликабельной ссылкой
 * (клик — открыть файл на правку). Токен ищется тем же разбором, что и на
 * сервере (extractCommandFile), поэтому подсвечивается ровно тот путь, чьё
 * содержимое показано ниже. Нет файла или токена в строке — команда как есть.
 */
function renderCommandWithFileLink(
  command: string,
  filePath: string | null,
  onOpen: () => void,
) {
  const token = filePath ? extractCommandFile(command) : null;
  const at = token ? command.indexOf(token) : -1;
  if (!token || at < 0) return command;
  return (
    <>
      {command.slice(0, at)}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
        title="Открыть файл для правки"
        className="text-primary hover:underline"
      >
        {token}
      </button>
      {command.slice(at + token.length)}
    </>
  );
}

/** Тоггл-переключатель вкл/выкл, как в настройках bb. */
function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-input",
      )}
    >
      {/* Бегунок контрастирует с дорожкой в ОБОИХ состояниях, как нативный
          свитч bb: тёмный на светлой (вкл) дорожке, светлый на тёмной (выкл).
          Один и тот же bg-background тонул в дорожке выкл — отсюда расхождение. */}
      <span
        className={cn(
          "inline-block h-4 w-4 rounded-full shadow transition-transform",
          checked
            ? "translate-x-[18px] bg-background"
            : "translate-x-0.5 bg-foreground",
        )}
      />
    </button>
  );
}

/** Выпадающий список режима; недоступен (полупрозрачен) при выключенном тоггле. */
function Dropdown<T extends string>({
  value,
  options,
  disabled,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  disabled: boolean;
  onChange: (next: T) => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as T)}
      className={cn(
        "h-8 rounded-md border border-border bg-background px-2 text-sm",
        disabled && "opacity-50",
      )}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Диалог создания навыка или агента: одно поле имени. Имя нормализуется в слаг
 * (латиница, цифры, дефисы) — при расхождении показываем, каким слагом файл
 * будет создан. `onCreate` возвращает текст ошибки или null при успехе.
 */
function CreateDialog({
  open,
  title,
  description,
  onClose,
  onCreate,
}: {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
  onCreate: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // При каждом открытии диалог чистый.
  useEffect(() => {
    if (open) {
      setName("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const slug = slugifyName(name);
  const canSubmit = isValidName(name) && !busy;

  const submit = () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    void onCreate(name).then((message) => {
      setBusy(false);
      if (message) setError(message);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            autoFocus
            value={name}
            placeholder="имя-через-дефис"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && submit()}
          />
          {name.trim() !== "" && slug !== name.trim() && (
            <p className="text-xs text-muted-foreground">
              Будет создан как: {slug || "—"}
            </p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Правая вкладка: показывает выбранный по `subPath` документ — SKILL.md навыка
 * либо файл по абсолютному пути (README плагина, память) — хостовым Markdown.
 * Ссылки на файлы внутри документа (и `<a>`, и файловые бэктик-код-спаны вида
 * `references/x.md`) открываются в этой же вкладке через единый `readDoc`;
 * стек хранит абсолютные пути для «назад».
 */
type Loaded = {
  path: string;
  content: string | null;
  error: string | null;
  sha256: string | null;
};

// Фронтматер файла — таблицей «поле → значение» во всю ширину страницы. Ключ
// прижат влево и не растягивается, значение занимает остаток. readOnly — для
// плагинов (манифест не правится через этот путь); иначе значения редактируемы.
// В таблицу идут только поля верхнего уровня; вложенные/сырые строки блока
// сохраняются при записи, но не показываются.
function FrontmatterTable({
  entries,
  onChange,
  readOnly = false,
}: {
  entries: FrontmatterEntry[];
  onChange?: (index: number, value: string) => void;
  readOnly?: boolean;
}) {
  // Только поля верхнего уровня; сохраняем исходный индекс для onChange.
  const fields: { key: string; value: string; index: number }[] = [];
  entries.forEach((entry, index) => {
    if (entry.kind === "field") {
      fields.push({ key: entry.key, value: entry.value, index });
    }
  });

  return (
    // Блок ограничен по ширине и по центру. Обёртка со скруглением и
    // overflow-hidden клиппит углы заливки; сетку рисуют границы ячеек, а не
    // border самой таблицы (иначе border-collapse ломает скругление).
    <div className="p-4">
      <div
        style={{ width: 668 }}
        className="mx-auto overflow-hidden rounded-lg border border-border"
      >
        <table className="w-full border-collapse text-sm">
          <tbody>
            {fields.map((field, pos) => {
              const notLast = pos < fields.length - 1;
              return (
                <tr key={field.index}>
                  <td
                    className={cn(
                      "w-px whitespace-nowrap border-r border-border bg-muted/50 px-3 py-2 align-top font-mono text-xs text-muted-foreground",
                      notLast && "border-b border-border",
                    )}
                  >
                    {field.key}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 align-top",
                      notLast && "border-b border-border",
                    )}
                  >
                    {readOnly ? (
                      <div className="whitespace-pre-wrap break-words">
                        {field.value}
                      </div>
                    ) : (
                      <textarea
                        rows={1}
                        value={field.value}
                        onChange={(event) =>
                          onChange?.(field.index, event.target.value)
                        }
                        className="cc-fm-value"
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DocTab({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const opener = normalizeOpener(
    (useSettings().values as { fileOpener?: unknown } | undefined)?.fileOpener,
  );
  const target = parseDocSubPath(subPath);
  const areaId = target?.areaId ?? "";
  // Реальный файл в режиме `md-opener` рисует MdDocView (он же грузит и правит).
  // Ветки composite/hook и режим `builtin` идут прежним путём ниже.
  const mdOpenerDoc = target?.kind === "doc" && opener === "md-opener";

  // Стек посещённых абсолютных путей (последний — текущий) и загруженный файл.
  const [stack, setStack] = useState<string[]>([]);
  const [doc, setDoc] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  // Режим правки: тот же MarkdownEditor, но editable; вход — кликом по тексту.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saveNote, setSaveNote] = useState<string | null>(null);
  // Композит (плагин: манифест + README) — уже готовый markdown, не редактируется.
  const [composite, setComposite] = useState(false);
  // Пути в поддереве папки документа — для подсказок / (путь). Редактор зовёт
  // pathProvider синхронно, поэтому список держим в памяти.
  const [docPaths, setDocPaths] = useState<string[]>([]);
  // Цели для подсказок @ (импорт): навыки и файлы памяти области — отдельный
  // источник, не подмножество docPaths, поэтому @code-st матчится по label
  // ("code-standards"), а не по файлам поддерева текущего документа.
  const [refTargets, setRefTargets] = useState<
    { value: string; label: string }[]
  >([]);
  // Доп. данные хука: его определение (JSON) и содержимое файла, который команда
  // читает или запускает (если опознан). Команда правится, эти два — для показа.
  const [hookExtra, setHookExtra] = useState<{
    definition: string | null;
    filePath: string | null;
    fileContent: string | null;
  } | null>(null);
  // Разбор фронтматера текущего документа: поля идут в таблицу, тело — в редактор.
  // hasFm=false → у файла нет фронтматера, тело равно всему содержимому.
  const [hasFm, setHasFm] = useState(false);
  const [fmEntries, setFmEntries] = useState<FrontmatterEntry[]>([]);
  const [fmBody, setFmBody] = useState("");
  // Манифест плагина (JSON) — его «фронтматер», показываем таблицей над README.
  const [pluginManifest, setPluginManifest] = useState<string | null>(null);

  // Собрать содержимое файла из полей и тела: с фронтматером — сериализуем блок,
  // без него — тело и есть весь файл.
  const composeContent = (entries: FrontmatterEntry[], body: string) =>
    hasFm ? serializeFrontmatter(entries, body) : body;

  // Разложить документ на фронтматер и тело. Композит (плагин/коннектор) и хук
  // имеют своё представление — их не трогаем, тело = всё содержимое.
  const splitDoc = (loaded: Loaded | null, isComposite: boolean) => {
    if (!loaded || loaded.content == null || isComposite) {
      setHasFm(false);
      setFmEntries([]);
      setFmBody(loaded?.content ?? "");
      return;
    }
    const parsed = parseFrontmatter(loaded.content);
    setHasFm(parsed.hasFrontmatter);
    setFmEntries(parsed.entries);
    setFmBody(parsed.body);
  };

  // Любой показ нового файла выходит из режима правки.
  const present = (result: Loaded) => {
    setDoc(result);
    setEditing(false);
    setSaveNote(null);
    setLoading(false);
    // Доп. хук-данные ставит только hook-ветка; для прочих документов сбрасываем.
    setHookExtra(null);
    // Манифест ставит только plugin-ветка; для прочих документов сбрасываем.
    setPluginManifest(null);
    // Префетч путей для подсказок / (тихо; ошибки не мешают показу).
    if (result.path && result.content != null) {
      void rpc
        .call("listDocPaths", { areaId, path: result.path })
        .then((r) => setDocPaths(r.paths))
        .catch(() => setDocPaths([]));
    } else {
      setDocPaths([]);
    }
    // Префетч целей для подсказок @ — не зависит от текущего файла, только
    // от области.
    if (areaId) {
      void rpc
        .call("listRefTargets", { areaId })
        .then((r) =>
          setRefTargets(
            r.targets.map((t) => ({ value: t.value, label: t.label })),
          ),
        )
        .catch(() => setRefTargets([]));
    } else {
      setRefTargets([]);
    }
  };

  // Пересобрать фронтматер/тело при смене документа или его типа. Читает
  // зафиксированные doc/composite (не из замыкания present), поэтому корректно
  // и после сохранения (doc.content обновился), и при переключении файла.
  useEffect(() => {
    splitDoc(doc, composite);
    // splitDoc зависит только от doc и composite.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, composite]);

  // Первый показ по subPath: навык резолвит сервер (readSkillFile), плагин —
  // манифест + README (readPlugin, композит), любой файл — по абсолютному пути
  // (readDoc). Абсолютный путь кладём в стек — по нему идут «назад» и ссылки.
  useEffect(() => {
    if (!target) {
      setDoc(null);
      setStack([]);
      setEditing(false);
      setComposite(false);
      return;
    }
    // Режим md-opener для файла: DocTab не грузит — MdDocView сам читает и правит.
    if (mdOpenerDoc) {
      setLoading(false);
      return;
    }
    let ok = true;
    setLoading(true);
    setDoc(null);

    if (target.kind === "plugin") {
      void rpc
        .call("readPlugin", { areaId: target.areaId, key: target.key })
        .then((result) => {
          if (!ok) return;
          // Ссылки в README считаем от папки плагина (папка README).
          const base = result.readmePath ?? result.manifestPath;
          setStack(base ? [base] : []);
          if (result.error && result.manifest == null) {
            setComposite(false);
            present({
              path: result.manifestPath,
              content: null,
              error: result.error,
              sha256: null,
            });
            return;
          }
          // Манифест уходит в таблицу-«фронтматер» (pluginManifest), тело —
          // README как есть. present() сбрасывает pluginManifest, поэтому
          // ставим его после present.
          setComposite(true);
          present({
            path: result.manifestPath,
            content: result.readme ?? "",
            error: null,
            sha256: null,
          });
          setPluginManifest(result.manifest);
        });
      return () => {
        ok = false;
      };
    }

    if (target.kind === "connector") {
      void rpc
        .call("readConnector", {
          areaId: target.areaId,
          name: target.name,
          origin: target.origin,
        })
        .then((result) => {
          if (!ok) return;
          setStack(result.path ? [result.path] : []);
          if (result.error || result.content == null) {
            setComposite(false);
            present({
              path: result.path,
              content: null,
              error: result.error,
              sha256: null,
            });
            return;
          }
          // Определение — срез большего файла, показываем JSON-блоком, не правим.
          setComposite(true);
          present({
            path: result.path,
            content: "```json\n" + result.content + "\n```",
            error: null,
            sha256: null,
          });
        });
      return () => {
        ok = false;
      };
    }

    if (target.kind === "hook") {
      void rpc
        .call("readHook", {
          areaId: target.areaId,
          origin: target.origin,
          index: target.index,
        })
        .then((result) => {
          if (!ok) return;
          setStack(result.path ? [result.path] : []);
          // Сырая команда (bash), не markdown-склейка — редактируется тем же
          // MarkdownEditor, что и обычный документ (см. writeHook в save()).
          setComposite(false);
          present({
            path: result.path,
            content: result.command,
            error: result.error,
            sha256: result.sha256,
          });
          setHookExtra({
            definition: result.definition,
            filePath: result.filePath,
            fileContent: result.fileContent,
          });
        });
      return () => {
        ok = false;
      };
    }

    setComposite(false);
    const request =
      target.kind === "skill"
        ? rpc.call("readSkillFile", {
            areaId: target.areaId,
            name: target.name,
            relPath: "SKILL.md",
          })
        : rpc.call("readDoc", { areaId: target.areaId, path: target.path });
    void request.then((result) => {
      if (!ok) return;
      setStack(result.path ? [result.path] : []);
      present(result);
    });
    return () => {
      ok = false;
    };
    // target выведен из subPath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subPath, rpc, mdOpenerDoc]);

  // Файловая ссылка внутри показанного документа (README плагина, ссылка в
  // редакторе) — это реальный файл: открываем его нативным опенером bb, а не
  // грузим во встроенную колонку.
  const openFile = useOpenFile(areaId);
  const openAbs = (abs: string) => void openFile(abs);

  // Клик по файловой ссылке внутри композитного (плагин/коннектор/хук)
  // документа: он рендерится хостовым `Markdown`, а не MarkdownEditor, так
  // как это склейка — не самостоятельный markdown-файл. Ловим `<a>` и
  // инлайн-код вида `references/x.md`. Считаем цель от текущего файла.
  const onCompositeClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const current = stack[stack.length - 1];
    if (!current) return;
    const element = event.target as HTMLElement;
    const anchor = element.closest("a");
    const code = element.closest("code");
    let ref: string | null = null;
    if (anchor) {
      const href = anchor.getAttribute("href") ?? "";
      if (isInTabLink(href)) ref = href;
    } else if (code) {
      ref = fileRefFromCode(code.textContent ?? "");
    }
    if (!ref) return;
    event.preventDefault();
    openAbs(resolveRelative(current, ref));
  };

  // linkResolver для MarkdownEditor: `[..](..)`-ссылки и `@`-импорты (atLinks)
  // резолвятся от пути текущего документа и открываются в этой же вкладке.
  // `~/` и абсолютный `/` отдаём как есть — сервер раскроет `~` и проверит
  // границы; относительный путь считаем от папки документа.
  const fromPath = doc?.path ?? stack[stack.length - 1] ?? "";
  const linkResolver = (href: string) => {
    if (!isInTabLink(href) && !href.startsWith("~/")) return null;
    const path = parseHref(href).path;
    const abs =
      path.startsWith("~/") || path.startsWith("/")
        ? path
        : resolveRelative(fromPath, path);
    return { onClick: () => openAbs(abs) };
  };

  // Подсказки редактора: @ (импорт) — всё ссылаемое сразу (навыки, память И
  // файлы поддерева), потому что валидную ссылку в документе даёт только @-импорт;
  // навыки/память матчатся по человекочитаемому label (@code-st → code-standards).
  // / (путь) — голые пути файлов поддерева, для случая, когда печатают путь без @.
  // Редактор зовёт pathProvider синхронно на каждый ввод, поэтому списки держим
  // заранее собранными в памяти (docPaths, refTargets).
  const pathProvider = (query: string, mode: "path" | "import") => {
    if (mode === "import") {
      const candidates = [
        ...refTargets,
        ...docPaths.map((p) => ({ value: p, label: p })),
      ];
      return rankCandidates(candidates, query, 8).map((c) => ({
        path: c.value,
        label: c.label ?? c.value,
      }));
    }
    return rankCandidates(
      docPaths.map((p) => ({ value: p })),
      query,
      8,
    ).map((c) => ({ path: c.value, label: c.value }));
  };

  const back = () => {
    if (stack.length < 2) return;
    const prev = stack[stack.length - 2];
    setStack((s) => s.slice(0, -1));
    setLoading(true);
    setComposite(false);
    void rpc.call("readDoc", { areaId, path: prev }).then(present);
  };

  const startEdit = () => {
    setDraft(doc?.content ?? "");
    setSaveNote(null);
    setEditing(true);
  };

  // Сохранение с CAS: sha из последнего чтения. Конфликт — сообщение, правку
  // не теряем; успех — обновляем содержимое и свежий sha, выходим из правки.
  // Принимает содержимое параметром (не читает `draft` из замыкания) — так
  // редакторский onSave (⌘S) может передать своё свежее значение синхронно,
  // не дожидаясь применения setDraft.
  const save = (content: string) => {
    if (!doc || !target) return;
    setSaveNote(null);
    // Хук пишется своим RPC (index-адресация в файле уровня), всё прочее —
    // обычной записью по пути.
    const request =
      target.kind === "hook"
        ? rpc.call("writeHook", {
            areaId,
            origin: target.origin,
            index: target.index,
            command: content,
            expectedSha256: doc.sha256,
          })
        : rpc.call("writeDoc", {
            areaId,
            path: doc.path,
            content,
            expectedSha256: doc.sha256,
          });
    void request.then((result) => {
      if (result.outcome === "written") {
        setDoc({
          path: doc.path,
          content,
          error: null,
          sha256: result.sha256,
        });
        setEditing(false);
      } else {
        setSaveNote(result.message ?? "Не удалось сохранить.");
      }
    });
  };

  if (!target) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Выберите слева навык, плагин или файл памяти, чтобы увидеть содержимое.
      </div>
    );
  }

  // Режим md-opener: колонка отдаёт файл целиком MdDocView (своя шапка, стек
  // прыжков, CAS). Без хлебных крошек и таблицы полей DocTab — чистый MD Opener.
  if (mdOpenerDoc && target.kind === "doc") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ColumnMdDocView areaId={target.areaId} initialPath={target.path} />
      </div>
    );
  }

  const heading =
    target.kind === "skill" || target.kind === "connector"
      ? target.name
      : target.kind === "hook"
        ? target.event
        : target.kind === "plugin"
          ? target.key.split("@")[0]
          : (doc?.path?.split("/").pop() ?? "");
  // Композит (плагин) не редактируем — это склейка двух файлов.
  const canEdit = !!doc && doc.content != null && !doc.error && !composite;

  // Клик по тексту в режиме просмотра — вход в правку. Ссылку ведёт сам
  // редактор через linkResolver, инлайн-код `references/x.md` — переход; всё
  // прочее — startEdit. В режиме правки клики обрабатывает редактор.
  const onDocClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (editing) return;
    const el = event.target as HTMLElement;
    if (el.closest(".mde-link")) return;
    const code = el.closest("code");
    if (code) {
      const current = stack[stack.length - 1];
      const ref = current ? fileRefFromCode(code.textContent ?? "") : null;
      if (ref) {
        event.preventDefault();
        openAbs(resolveRelative(current as string, ref));
        return;
      }
    }
    if (canEdit) startEdit();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-2 border-b border-border p-3">
        {!editing && stack.length > 1 && (
          <button
            type="button"
            onClick={back}
            className="shrink-0 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
            aria-label="Назад"
          >
            ←
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{heading}</div>
          {/* Маркетплейс плагина живёт в ключе (name@marketplace) — показываем
              его у шапки тела, а не второй строкой в списке. */}
          {target.kind === "plugin" && target.key.includes("@") && (
            <div className="truncate text-xs text-muted-foreground">
              {target.key.slice(target.key.indexOf("@") + 1)}
            </div>
          )}
          {doc?.path && (
            <div className="truncate text-xs text-muted-foreground">
              {doc.path}
            </div>
          )}
          {saveNote && (
            <div className="text-xs text-destructive">{saveNote}</div>
          )}
        </div>
        {editing && (
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => save(draft)}
              className="rounded-md px-2 py-1 text-sm text-primary hover:bg-muted"
              aria-label="Сохранить"
            >
              Сохранить
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setSaveNote(null);
                // Откат несохранённых правок фронтматера и тела к файлу.
                splitDoc(doc, composite);
              }}
              className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
              aria-label="Отмена"
            >
              Отмена
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <p className="p-4 text-sm text-muted-foreground">Загрузка…</p>
        )}
        {!loading && doc?.error && (
          <p className="p-4 text-sm text-destructive">{doc.error}</p>
        )}
        {!loading && doc?.content != null && composite && (
          <div onClick={onCompositeClick}>
            {/* Плагин: манифест таблицей во всю ширину, ниже — README. */}
            {target.kind === "plugin" && pluginManifest && (
              <FrontmatterTable
                entries={fieldsFromJson(pluginManifest)}
                readOnly
              />
            )}
            {doc.content && (
              <div className="p-4">
                <Markdown content={doc.content} />
              </div>
            )}
          </div>
        )}
        {!loading && doc?.content != null && !composite && target.kind === "hook" && (
          <div className="flex flex-col gap-4 p-4">
            {hookExtra?.definition && (
              <section>
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  Определение
                </div>
                <Markdown content={"```json\n" + hookExtra.definition + "\n```"} />
              </section>
            )}
            <section>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Команда {editing ? "" : "(клик — правка)"}
              </div>
              {editing ? (
                <div onClick={onDocClick}>
                  <MarkdownEditor
                    editable
                    value={draft}
                    onChange={setDraft}
                    onSave={(md) => {
                      setDraft(md);
                      save(md);
                    }}
                    className="cc-doc-mde"
                  />
                </div>
              ) : (
                <div
                  onClick={onDocClick}
                  className="cursor-text whitespace-pre-wrap break-all rounded-md border border-border bg-muted/30 p-2 font-mono text-sm"
                >
                  {renderCommandWithFileLink(
                    doc.content,
                    hookExtra?.filePath ?? null,
                    () =>
                      hookExtra?.filePath &&
                      navigate.toPluginPanel(PANEL_PATH, {
                        subPath: docSubPath(areaId, hookExtra.filePath),
                      }),
                  )}
                </div>
              )}
            </section>
            {hookExtra?.fileContent && (
              <section>
                <Markdown
                  content={asMarkdown(
                    hookExtra.filePath ?? "",
                    hookExtra.fileContent,
                  )}
                />
              </section>
            )}
          </div>
        )}
        {!loading && doc?.content != null && !composite && target.kind !== "hook" && (
          <div className="flex h-full flex-col">
            {hasFm && fmEntries.some((entry) => entry.kind === "field") && (
              <FrontmatterTable
                entries={fmEntries}
                onChange={(index, value) => {
                  const next = setFieldValue(fmEntries, index, value);
                  setFmEntries(next);
                  setEditing(true);
                  setDraft(composeContent(next, fmBody));
                }}
              />
            )}
            <div className="min-h-0 flex-1 p-4" onClick={onDocClick}>
              <MarkdownEditor
                editable={editing}
                atLinks
                value={editing ? fmBody : asMarkdown(doc.path, fmBody)}
                onChange={(md) => {
                  setFmBody(md);
                  setDraft(composeContent(fmEntries, md));
                }}
                linkResolver={linkResolver}
                pathProvider={pathProvider}
                onSave={(md) => {
                  const content = composeContent(fmEntries, md);
                  setDraft(content);
                  save(content);
                }}
                className="h-full cc-doc-mde"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- раздел «Workflows» (перенос bb-plugin-workflow-composer, без колонки кода) ----

// Дерево редактора живёт в module-level editorStore (см. ./src/workflow/store) — общий для конструктора
// и превью кода нескольких хостовых точек монтирования; здесь читаем его тем же способом.
const useEditor = () =>
  useSyncExternalStore(editorStore.subscribe, editorStore.getSnapshot, editorStore.getSnapshot);

interface WfItem {
  name: string;
  path: string;
  store: StoreKind;
  description: string;
  hasTree: boolean;
}
const AGENT_SCOPE_LABEL: Record<"user" | "project" | "plugin", string> = {
  user: "личный",
  project: "проектный",
  plugin: "плагин",
};

function useWfAgents(rpc: Rpc, projectId: string | null): AgentOption[] {
  const [agents, setAgents] = useState<AgentOption[]>([]);
  useEffect(() => {
    void rpc.call("wfAgents", { projectId }).then((r) => setAgents(r.agents));
  }, [rpc, projectId]);
  return agents;
}

// Счётчик workflow для рейки (раздел «Workflows»). Обновляется при смене области, как и остальные
// счётчики; null — пока не загрузился.
function useWfCount(rpc: Rpc, areaId: string): number | null {
  const [count, setCount] = useState<number | null>(null);
  const projectId = areaId === "global" ? null : areaId;
  useEffect(() => {
    let alive = true;
    void rpc.call("wfList", { projectId }).then((r) => {
      if (alive) setCount((r.items as WfItem[]).length);
    });
    return () => {
      alive = false;
    };
  }, [rpc, projectId]);
  return count;
}

function useWfProviderCatalog(rpc: Rpc): ProviderCatalogEntry[] {
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[]>([]);
  useEffect(() => {
    void rpc.call("wfProviderCatalog", null).then((r) => setCatalog(r));
  }, [rpc]);
  return catalog;
}

// Поллинг статуса запуска: `wfStatus` — бесплатная операция чтения, текст CLI показываем как есть.
function pollStatus(rpc: Rpc, runId: string, setOutput: (s: string) => void): void {
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
    void rpc.call("wfStatus", { runId }).then((r) => setOutput(r.output));
    if (ticks >= 15) clearInterval(timer);
  }, 2000);
}

// Написанный вручную .js без дерева-мирроора конструктора — показываем исходник как есть, без правки:
// сохранение поверх него скомпилировало бы заглушку-дерево и стёрло бы настоящий код.
function CodeOnlyView({ source }: { source: string }) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
        Написан вручную — нет дерева конструктора. Только чтение; правьте .js-файл напрямую.
      </div>
      <pre className="flex-1 overflow-auto p-4 font-mono text-xs text-foreground" aria-label="workflow source">
        {source}
      </pre>
    </div>
  );
}

function WfList({
  items,
  onOpen,
  activePath,
}: {
  items: WfItem[];
  onOpen: (i: WfItem) => void;
  activePath?: string;
}) {
  return (
    <div className="space-y-1">
      {items.length === 0 && <div className="px-1 py-0.5 text-xs text-muted-foreground">пусто</div>}
      {items.map((item) => (
        <button
          key={item.path}
          type="button"
          onClick={() => onOpen(item)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
            activePath === item.path && "bg-accent",
          )}
          title={item.description || item.name}
        >
          <span className="min-w-0 flex-1 truncate">{item.name}</span>
          {!item.hasTree && (
            <span className="shrink-0 text-xs text-muted-foreground" title="Файл без дерева конструктора — откроется как код">
              только код
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// Диалог сохранения: имя + хранилище (project → .bb/workflows, движок bb; global → ~/.claude/workflows,
// движок Claude Code). Движок выводится из хранилища (engineForStore) — они всегда в паре.
function WfSaveDialog({
  open,
  onOpenChange,
  rpc,
  projectId,
  tree,
  defaultName,
  defaultStore,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rpc: Rpc;
  projectId: string | null;
  tree: Tree;
  defaultName: string;
  defaultStore: StoreKind;
  onSaved: (identity: Identity) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [store, setStore] = useState<StoreKind>(defaultStore);
  useEffect(() => {
    if (open) {
      setName(defaultName);
      setStore(defaultStore);
    }
  }, [open, defaultName, defaultStore]);

  const engine: Engine = engineForStore(store);

  const save = async () => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name.trim())) {
      toast.error("Имя — латиница в нижнем регистре, цифры и дефисы, без пробелов (например review-changes)");
      return;
    }
    // Движок bb требует непустое описание — проверяем здесь, чтобы сохранение не создало невалидный файл.
    if (engine === "bb" && !tree.description.trim()) {
      toast.error("Добавьте описание, чтобы сохранить в проект — движку bb оно обязательно");
      return;
    }
    try {
      const res = await rpc.call("wfSave", { projectId, store, name: name.trim(), source: compile(tree, engine) });
      toast.success(store === "project" ? "Сохранено в проект" : "Сохранено глобально");
      onOpenChange(false);
      onSaved({ store, path: res.path, name: name.trim() });
    } catch (e) {
      toast.error("Не удалось сохранить: " + String((e as Error).message ?? e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Сохранить workflow</DialogTitle>
          <DialogDescription>Куда сохранить и под каким именем.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs text-muted-foreground">Куда</span>
            <select
              aria-label="save destination"
              value={store}
              onChange={(e) => setStore(e.target.value as StoreKind)}
              className="flex h-9 w-full items-center rounded-md border border-border bg-transparent px-3 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="project" disabled={!projectId}>
                Проект · .bb/workflows · движок bb{!projectId ? " — нет проекта" : ""}
              </option>
              <option value="global">Глобально · ~/.claude/workflows · Claude Code</option>
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs text-muted-foreground">Имя (kebab-case)</span>
            <Input
              aria-label="save name"
              placeholder="review-changes"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={save} aria-label="confirm save">
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Тело раздела «Workflows»: список (кол.2) + сам конструктор (кол.3) + при выбранном шаге-агенте —
// объединённая колонка 4 (список доступных типов агента либо, после выбора, деталь агента). Колонки
// 2–3 регулируются независимо, со своими ключами localStorage — так же, как рейка и список раздела в
// ConfigPanel; колонка 4 ширины не регулирует, занимает всю оставшуюся ширину страницы.
function WorkflowsView({ rpc, areaId }: { rpc: Rpc; areaId: string }) {
  const { tree, identity, rawSource } = useEditor();
  const codeOnly = rawSource != null;

  // Проект workflow — та же ось, что «Область» в шапке Cloud Config: сентинел "global" означает
  // глобальную область, любое другое значение areaId — id bb-проекта.
  const projectId = areaId === "global" ? null : areaId;
  const [items, setItems] = useState<WfItem[]>([]);
  const [output, setOutput] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [selectedPath, setSelectedPath] = useState<OutlinePath | null>(null);
  // Объединённая колонка 4 (агенты + деталь): список агентов либо деталь уже
  // выбранного (файл + настройки). Переключается кликом по агенту / кнопкой «Назад».
  const [pickerOpen, setPickerOpen] = useState(true);

  const agents = useWfAgents(rpc, projectId);
  const providerCatalog = useWfProviderCatalog(rpc);

  // Смена области — устаревший выбранный шаг (кол.4) относится к прежнему дереву/проекту.
  useEffect(() => {
    setSelectedPath(null);
  }, [projectId]);

  const refresh = () => {
    void rpc.call("wfList", { projectId }).then((r) => setItems(r.items as WfItem[]));
  };
  // rpc — стабильная ссылка на время жизни панели, refresh — новая функция на каждый рендер; в
  // зависимостях достаточно того, что реально меняет список.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [projectId]);

  const openItem = async (item: WfItem) => {
    const res = await rpc.call("wfRead", { projectId: projectId, store: item.store, path: item.path });
    const parsedTree = res.tree as Tree | null;
    // Нет дерева конструктора → написанный вручную файл: открываем как есть, read-only.
    editorStore.load(
      parsedTree ?? blankTree(item.name),
      { store: item.store, path: item.path, name: item.name },
      parsedTree ? null : res.source,
    );
    setSelectedPath(null);
  };

  // `bb workflows` работает только с проектными (bb) workflow. Глобальные (~/.claude) — Claude Code,
  // проверка/запуск для них недоступны из этой панели.
  const bbRunnable = identity?.store === "project";

  const doValidate = async () => {
    if (!identity) {
      toast.error("Сначала сохраните workflow — проверка смотрит файл на диске");
      return;
    }
    if (!bbRunnable) {
      toast.error("Проверка доступна только для проектных workflow; глобальные выполняются через Claude Code");
      return;
    }
    const res = await rpc.call("wfValidate", { projectId: projectId, store: identity.store, path: identity.path });
    setOutput(res.output || (res.ok ? "Ошибок нет" : "Есть ошибки"));
    if (res.ok) toast.success("Проверка прошла");
    else toast.error("Проверка нашла ошибки — см. вывод ниже");
  };

  const doRun = async () => {
    if (!identity) {
      toast.error("Сначала сохраните workflow — запуск выполняет файл на диске");
      return;
    }
    if (!bbRunnable) {
      toast.error("Запуск доступен только для проектных workflow; глобальные выполняются через Claude Code");
      return;
    }
    const res = await rpc.call("wfRun", { projectId: projectId, store: identity.store, path: identity.path });
    setOutput(res.output);
    if (res.runId) {
      toast.success("Запущено");
      pollStatus(rpc, res.runId, setOutput);
    } else {
      toast.error("Не удалось запустить — см. вывод ниже");
    }
  };

  const doDelete = async () => {
    if (!identity) return;
    await rpc.call("wfRemove", { projectId: projectId, store: identity.store, path: identity.path });
    toast.success("Workflow удалён");
    editorStore.newWorkflow();
    setSelectedPath(null);
    refresh();
  };

  // Выбранный шаг-агент (для объединённой колонки 4): узел по selectedPath, если это агент, а не фаза/группа.
  const node: Phase | Step | null = selectedPath ? nodeAt(tree, selectedPath) : null;
  const selAgent: Agent | null = node && "type" in node && node.type === "agent" ? node : null;
  // Файл выбранного шаблона-агента — его показывает верхняя половина детали в отображении
  // Kasimov (тот же MdDocView, что и слот MD Opener). Нет шаблона или пути — верхней половины нет.
  const selAgentPath: string | null = selAgent ? agents.find((a) => a.value === selAgent.agentType)?.path ?? null : null;

  // Новый выбранный шаг: сразу открыта деталь, если шаблон у него уже назначен, иначе —
  // список для выбора. Дальше переключение — кликом по агенту в списке или кнопкой «Назад»,
  // поэтому в зависимостях только selectedPath — правку selAgent.agentType (выбор шаблона)
  // не должна откатывать pickerOpen обратно.
  useEffect(() => {
    setPickerOpen(!selAgent || selAgent.agentType.trim() === "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath]);

  const { width: listWidth, startResize: startListResize } = useResizableWidth({
    initial: 240,
    min: 200,
    max: 400,
    side: "left",
    storageKey: "claude-config:wf-list-width",
  });
  const { width: constructorWidth, startResize: startConstructorResize } = useResizableWidth({
    initial: 360,
    min: 220,
    max: 760,
    side: "left",
    // Ключ с суффиксом -v2: прежняя версия успела записать 540 в localStorage при
    // монтировании (useResizableWidth пишет ширину и на маунте), из-за чего новый
    // initial игнорировался. Новый ключ даёт свежий старт 360, тянется до 220.
    storageKey: "claude-config:wf-constructor-width-v2",
  });
  // Объединённая колонка 4 своей регулируемой ширины не имеет — она берёт всю оставшуюся
  // ширину страницы (flex-1); резервной шириной колонки-списка распоряжается только
  // constructorWidth (ручка между конструктором и этой колонкой).
  // Высота верхней половины колонки деталей — файл агента в Kasimov; ручка снизу, тянем вниз — выше.
  const { height: agentFileHeight, startResize: startAgentFileResize } = useResizableHeight({
    initial: 280,
    min: 120,
    max: 640,
    storageKey: "claude-config:wf-agent-file-height",
  });

  // Валидность конструктора: агент годен только с выбранным шаблоном. Пока шаблон не выбран хотя бы у
  // одного агента — Workflow не валиден, сохранение заблокировано.
  const invalidAgents = agentsMissingTemplate(tree);

  return (
    // min-w-0 flex-1 — этот корень сам сидит flex-item'ом в строке ConfigPanel (рядом с рейкой
    // разделов); без них он не растягивался на всю ширину страницы, а сжимался по контенту —
    // из-за этого объединённая колонка 4 ниже не могла дотянуться до правого края.
    <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-x-auto">
      <div style={{ width: listWidth }} className="flex h-full shrink-0 flex-col overflow-hidden border-r border-border">
        <div className="flex flex-col gap-2 border-b border-border p-2">
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" onClick={() => setSaveOpen(true)} disabled={codeOnly || invalidAgents > 0}>
              Сохранить
            </Button>
            <Button size="sm" variant="outline" onClick={doValidate} disabled={!bbRunnable}>
              Проверить
            </Button>
            <Button size="sm" variant="outline" onClick={doRun} disabled={!bbRunnable}>
              Запустить
            </Button>
            <Button size="sm" variant="outline" onClick={doDelete} disabled={!identity}>
              Удалить
            </Button>
          </div>
          {!codeOnly && invalidAgents > 0 && (
            <p className="text-xs text-muted-foreground">
              Workflow не валиден: у {invalidAgents} {invalidAgents === 1 ? "агента" : "агентов"} не выбран
              шаблон. Выберите агент в колонке «Агенты».
            </p>
          )}
        </div>
        {output && (
          <pre className="max-h-32 shrink-0 overflow-auto border-b border-border bg-muted p-2 text-xs text-foreground" aria-label="output">
            {output}
          </pre>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <button
            type="button"
            onClick={() => {
              editorStore.newWorkflow();
              setSelectedPath(null);
            }}
            className="mb-3 flex w-full items-center justify-center rounded-md border border-border bg-muted/40 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            + Новый workflow
          </button>
          {/* Плоский список: разделение по проектам уже задано «Областью» в шапке Cloud Config. */}
          <WfList items={items} onOpen={openItem} activePath={identity?.path} />
        </div>
      </div>

      <ResizeHandle onPointerDown={startListResize} />

      <div style={{ width: constructorWidth }} className="h-full min-h-0 min-w-0 shrink-0 overflow-hidden">
        {codeOnly ? (
          <CodeOnlyView source={rawSource!} />
        ) : (
          <OutlineEditor
            agents={agents}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
          />
        )}
      </div>

      <ResizeHandle onPointerDown={startConstructorResize} />

      {!codeOnly && selAgent && (
        // Колонка 4 — объединённая: список агентов (выбор шаблона) либо, после выбора, деталь —
        // файл шаблона в отображении Kasimov сверху и правки шага (модель·эфорт, инструкции,
        // формат вывода) снизу. Своей ширины не держит — занимает всю оставшуюся ширину страницы;
        // между списком и деталью переключает клик по агенту / кнопка «Назад», а не соседняя колонка.
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-border">
          {pickerOpen ? (
            <div className="flex h-full flex-col gap-0.5 overflow-y-auto p-2">
              <div className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Агенты
              </div>
              {agents.map((a) => (
                <button
                  key={a.path ?? a.value}
                  type="button"
                  onClick={() => {
                    editorStore.update((draft) =>
                      applyTemplate(draft, selectedPath!, a.value, { model: a.model, effort: a.effort, provider: a.provider }),
                    );
                    setPickerOpen(false);
                  }}
                  className="block w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
                >
                  <div className="truncate text-sm font-medium">{a.value}</div>
                  <div className="text-xs text-muted-foreground">{AGENT_SCOPE_LABEL[a.scope ?? "user"]}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              {/* Нет файла шаблона (агент ещё не подтянулся/без .md) — своей шапки у
                  AgentDetails ниже нет, поэтому кнопка назад держится тут отдельно.
                  Когда файл есть, она уезжает в общую шапку MdDocView (leading ниже) —
                  так стрелка, путь файла и «Редактировать» оказываются в одной строке. */}
              {!selAgentPath && (
                <div className="flex shrink-0 items-center border-b border-border p-1">
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
                    aria-label="Назад к списку агентов"
                  >
                    ← Агенты
                  </button>
                </div>
              )}
              {selAgentPath && (
                <>
                  <div style={{ height: agentFileHeight }} className="shrink-0 overflow-hidden">
                    <ColumnMdDocView
                      areaId={areaId}
                      initialPath={selAgentPath}
                      leading={
                        <button
                          type="button"
                          onClick={() => setPickerOpen(true)}
                          className="mdo-back"
                          aria-label="Назад к списку агентов"
                        >
                          ←
                        </button>
                      }
                      editButton={(onClick) => (
                        <button
                          type="button"
                          onClick={onClick}
                          className="mdo-btn mdo-btn-icon"
                          aria-label="Редактировать"
                          title="Редактировать"
                        >
                          <Icon name="Edit" className="size-4" />
                        </button>
                      )}
                    />
                  </div>
                  <HorizontalResizeHandle onPointerDown={startAgentFileResize} />
                </>
              )}
              <div className="min-h-0 flex-1 overflow-hidden">
                <AgentDetails
                  agent={selAgent}
                  agents={agents}
                  providerCatalog={providerCatalog}
                  onSetField={(patch) => editorStore.update((draft) => setAgentField(draft, selectedPath!, patch))}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <WfSaveDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        rpc={rpc}
        projectId={projectId}
        tree={tree}
        defaultName={identity?.name ?? tree.name}
        defaultStore={identity?.store ?? (projectId ? "project" : "global")}
        onSaved={(nextIdentity) => {
          editorStore.load(structuredClone(editorStore.getSnapshot().tree), nextIdentity);
          refresh();
        }}
      />
    </div>
  );
}

function ConfigPanel({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [areas, setAreas] = useState<{ id: string; label: string }[]>([]);
  const [areaId, setAreaId] = useState("global");
  const [config, setConfig] = useState<AreaConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [memory, setMemory] = useState<
    { id: string; label: string; path: string }[]
  >([]);
  // Какой диалог создания открыт: навык, агент или ни один.
  const [createKind, setCreateKind] = useState<"skill" | "agent" | null>(null);
  // Активный раздел в средней колонке; null → пустое состояние.
  const [section, setSection] = useState<SectionId | null>(null);
  // Режим включённых навыков — общий для всего раздела (один список в шапке,
  // а не по навыку). Включение навыка применяет этот режим.
  const [skillMode, setSkillMode] = useState<SkillMode>("on");

  // Что открыто во второй колонке (для подсветки), если относится к этой области.
  const open = parseDocSubPath(subPath);
  // Рейка и средняя колонка (список раздела) — ограниченной, регулируемой
  // ширины; ручка на правом крае каждой (side "left"). Документ занимает
  // остаток (flex-1), своей ручки не имеет.
  const { width: railWidth, startResize: startRailResize } = useResizableWidth({
    initial: 240,
    min: 180,
    max: 400,
    side: "left",
    storageKey: "claude-config:rail-width",
  });
  const { width: midWidth, startResize: startMidResize } = useResizableWidth({
    initial: 360,
    min: 260,
    max: 640,
    side: "left",
    storageKey: "claude-config:section-width",
  });
  const openHere = open && open.areaId === areaId ? open : null;
  const selectedName = openHere?.kind === "skill" ? openHere.name : null;
  const selectedPluginKey = openHere?.kind === "plugin" ? openHere.key : null;
  const selectedConnector = openHere?.kind === "connector" ? openHere : null;
  const selectedHook = openHere?.kind === "hook" ? openHere : null;
  // Открытый файл по пути (README плагина или память) — подсветка по совпадению.
  const openDocPath = openHere?.kind === "doc" ? openHere.path : null;

  useEffect(() => {
    void rpc.call("listAreas").then((result) => {
      if ("areas" in result) setAreas(result.areas);
    });
  }, [rpc]);

  useEffect(() => {
    let alive = true;
    void rpc.call("listMemory", { areaId }).then((result) => {
      if (alive && "entries" in result) setMemory(result.entries);
    });
    return () => {
      alive = false;
    };
  }, [areaId, rpc]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void rpc.call("getConfig", { areaId }).then((next) => {
      if (alive) {
        setConfig(next as AreaConfig);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
    // notice сбрасываем при смене области — старая причина к ней не относится.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaId, rpc]);

  // Перечитывание после записи НЕ трогает loading: карточки остаются
  // смонтированными, значения обновляются на месте — страница не прыгает к началу.
  const reload = () => {
    void rpc.call("getConfig", { areaId }).then((next) => {
      setConfig(next as AreaConfig);
    });
  };

  // Итог записи: ok — перечитать область; иначе показать причину баннером,
  // тоже перечитав, чтобы показать актуальное состояние файла.
  const handleResult = (result: WriteOutcome) => {
    setNotice(result.outcome === "ok" ? null : result.message);
    reload();
  };

  const setPlugin = (key: string, value: boolean) =>
    void rpc.call("setPlugin", { areaId, key, value }).then(handleResult);
  const setConnector = (name: string, value: boolean) =>
    void rpc.call("setConnector", { areaId, name, value }).then(handleResult);
  const setSkill = (name: string, state: SkillTarget) =>
    void rpc.call("setSkill", { areaId, name, state }).then(handleResult);
  const setToolSearch = (mode: ToolSearchTarget) =>
    void rpc.call("setToolSearch", { areaId, mode }).then(handleResult);
  const setHookEnabled = (
    hook: { origin: HookOrigin; event: string; matcher: string | null; command: string },
    enabled: boolean,
  ) =>
    void rpc
      .call("setHookEnabled", {
        areaId,
        origin: hook.origin,
        event: hook.event,
        matcher: hook.matcher,
        command: hook.command,
        enabled,
      })
      .then(handleResult);

  const changeArea = (id: string) => {
    setNotice(null);
    setAreaId(id);
    // Выбор навыка относится к прежней области — снимаем.
    navigate.toPluginPanel(PANEL_PATH, { subPath: "", replace: true });
  };
  // Навык, агент, документ — реальные файлы: открываем нативным опенером bb.
  const openFile = useOpenFile(areaId);
  const openPlugin = (key: string) =>
    navigate.toPluginPanel(PANEL_PATH, { subPath: pluginSubPath(areaId, key) });
  const openConnector = (origin: ConnectorOrigin, name: string) =>
    navigate.toPluginPanel(PANEL_PATH, {
      subPath: connectorSubPath(areaId, origin, name),
    });
  const openHook = (origin: HookOrigin, index: number, event: string) =>
    navigate.toPluginPanel(PANEL_PATH, {
      subPath: hookSubPath(areaId, origin, index, event),
    });

  // Создание навыка: успех перечитывает список и открывает новый SKILL.md
  // нативным опенером; иначе диалог остаётся с сообщением (имя занято/недопустимо).
  const createSkill = (name: string): Promise<string | null> =>
    rpc.call("createSkill", { areaId, name }).then((result) => {
      if (result.outcome === "created") {
        setCreateKind(null);
        reload();
        if (result.path) void openFile(result.path);
        return null;
      }
      return result.message ?? "Не удалось создать навык.";
    });

  // Создание агента: успех открывает новый файл по пути из ответа сервера.
  const createAgent = (name: string): Promise<string | null> =>
    rpc.call("createAgent", { areaId, name }).then((result) => {
      if (result.outcome === "created" && result.path) {
        setCreateKind(null);
        reload();
        void openFile(result.path);
        return null;
      }
      return result.message ?? "Не удалось создать агента.";
    });

  // Счётчик workflow для рейки — из wfList по текущей области (config его не несёт).
  const wfCount = useWfCount(rpc, areaId);

  // Разделы рейки: id → заголовок и число элементов. Считаем из config,
  // чтобы рейка и содержимое не разошлись. null-счётчик — раздел без списка.
  const sections: { id: SectionId; title: string; count: number | null }[] =
    config && !config.error
      ? [
          { id: "hooks", title: "Хуки", count: config.hooks.length },
          { id: "plugins", title: "Плагины", count: config.plugins.length },
          { id: "connectors", title: "Коннекторы", count: config.connectors.length },
          { id: "skills", title: "Навыки", count: config.skills.length },
          { id: "agents", title: "Агенты", count: config.agents.length },
          { id: "workflows", title: "Workflows", count: wfCount },
          { id: "toolSearch", title: "Подгрузка инструментов", count: null },
        ]
      : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Общая шапка: область + баннеры записи — над всеми колонками. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Область</span>
          <ProjectSwitcher
            options={areas.map((area) => ({ key: area.id, label: area.label }))}
            isSelected={(key) => key === areaId}
            onSelect={(key) => changeArea(String(key))}
          />
        </div>
        {config?.editedFilePath && (
          <p className="text-xs text-muted-foreground">
            Пишет в {config.editedFilePath}
          </p>
        )}
        {notice && (
          <div className="w-full rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {notice}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Внешний уровень навигации: память + разделы. */}
        <nav
          style={{ width: railWidth }}
          className="flex shrink-0 flex-col gap-4 overflow-y-auto p-2"
        >
          {memory.length > 0 && (
            <div>
              <div className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Память
              </div>
              {memory.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  title={entry.path}
                  // Файл памяти вытесняет раздел: средней колонки быть не должно.
                  onClick={() => {
                    setSection(null);
                    void openFile(entry.path);
                  }}
                  className={cn(
                    "flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                    openDocPath === entry.path && "bg-accent",
                  )}
                >
                  <span className="truncate">{entry.label}</span>
                </button>
              ))}
            </div>
          )}

          <div>
            <div className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Разделы
            </div>
            {sections.map((item) => (
              <button
                key={item.id}
                type="button"
                // Смена раздела очищает и список (перерисуется), и документ
                // (закрываем открытый файл — 3-я колонка пустеет).
                onClick={() => {
                  setSection(item.id);
                  navigate.toPluginPanel(PANEL_PATH, {
                    subPath: "",
                    replace: true,
                  });
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                  section === item.id && "bg-accent",
                )}
              >
                <span className="truncate">{item.title}</span>
                {item.count != null && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {item.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>

        <ResizeHandle onPointerDown={startRailResize} />

        {loading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
            Загрузка…
          </div>
        ) : config?.error ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Файл {config.error.file} не разобрать: {config.error.message}
            </div>
          </div>
        ) : open && section === null ? (
          // Файл памяти: документ во всю оставшуюся ширину, без средней колонки.
          <div className="min-h-0 flex-1 overflow-hidden">
            <DocTab subPath={subPath} />
          </div>
        ) : section === "workflows" ? (
          <WorkflowsView rpc={rpc} areaId={areaId} />
        ) : section !== null ? (
          <>
            {/* Средняя колонка — список раздела, ограниченной регулируемой ширины. */}
            <div
              style={{ width: midWidth }}
              className="min-h-0 shrink-0 overflow-y-auto p-4"
            >
              <div className="space-y-4">
            {config && !config.error && section === "hooks" && (
              <div>
                <h2 className="mb-2 text-sm font-semibold">Хуки</h2>
                {config.hooks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Хуков не найдено.
                  </p>
                ) : (
                  <p className="mb-2 text-xs text-muted-foreground">
                    Тумблер выключает хук — Claude Code его не отключает сам,
                    поэтому панель вырезает хук в своё хранилище и возвращает
                    при включении. Клик по строке открывает и правит команду.
                  </p>
                )}
                <div className="space-y-0.5">
                  {config.hooks.map((hook) => {
                    const selected =
                      selectedHook?.origin === hook.origin &&
                      selectedHook?.index === hook.index &&
                      selectedHook?.event === hook.event;
                    const infoContent = (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {hook.event}
                          </span>
                          {hook.matcher && (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              matcher: {hook.matcher}
                            </span>
                          )}
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                            {HOOK_ORIGIN_LABEL[hook.origin]}
                          </span>
                        </div>
                        <div className="truncate font-mono text-xs text-muted-foreground">
                          {hook.command}
                        </div>
                      </>
                    );
                    return (
                      <div
                        key={`${hook.origin}:${hook.event}:${hook.index}:${hook.command}`}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors",
                          hook.enabled && "hover:bg-muted",
                          selected && "bg-accent",
                          !hook.enabled && "opacity-60",
                        )}
                      >
                        {hook.enabled ? (
                          <button
                            type="button"
                            onClick={() =>
                              openHook(hook.origin, hook.index, hook.event)
                            }
                            className="min-w-0 flex-1 text-left"
                          >
                            {infoContent}
                          </button>
                        ) : (
                          <div className="min-w-0 flex-1">{infoContent}</div>
                        )}
                        <Switch
                          checked={hook.enabled}
                          onChange={(next) => setHookEnabled(hook, next)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {!loading && config && !config.error && section === "plugins" && (
              <div>
                <h2 className="mb-2 text-sm font-semibold">
                  Плагины Claude Code
                </h2>
                {config.plugins.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Установленных плагинов не найдено.
                  </p>
                )}
                <div className="space-y-0.5">
                  {config.plugins.map((plugin) => (
                    <div
                      key={plugin.key}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors",
                        plugin.installPath && "hover:bg-muted",
                        selectedPluginKey === plugin.key && "bg-accent",
                        plugin.dimmed && "opacity-60",
                      )}
                    >
                      {plugin.installPath ? (
                        <button
                          type="button"
                          onClick={() => openPlugin(plugin.key)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="truncate text-sm font-medium">
                            {plugin.name}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {secondLine(plugin.tokens, plugin.version ?? "")}
                          </div>
                        </button>
                      ) : (
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {plugin.name}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {secondLine(plugin.tokens, plugin.version ?? "")}
                          </div>
                        </div>
                      )}
                      <Switch
                        checked={plugin.value}
                        onChange={(next) => setPlugin(plugin.key, next)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!loading && config && !config.error && section === "connectors" && (
              <div>
                <h2 className="mb-2 text-sm font-semibold">Коннекторы</h2>
                {config.connectors.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Коннекторов не найдено.
                  </p>
                )}
                <div className="space-y-0.5">
                  {config.connectors.map((connector) => (
                    <div
                      key={`${connector.origin}:${connector.name}`}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-muted",
                        selectedConnector?.name === connector.name &&
                          selectedConnector?.origin === connector.origin &&
                          "bg-accent",
                        connector.dimmed && "opacity-60",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          openConnector(connector.origin, connector.name)
                        }
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="truncate text-sm font-medium">
                          {connector.name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {secondLine(
                            connector.tokens,
                            connectorSubtitle(
                              connector.origin,
                              connector.transport,
                            ),
                          )}
                        </div>
                      </button>
                      {connector.toggleable ? (
                        <Switch
                          checked={connector.value}
                          onChange={(next) =>
                            setConnector(connector.name, next)
                          }
                        />
                      ) : (
                        // user/local из ~/.claude.json settings.json не гейтит.
                        <span className="shrink-0 text-xs text-muted-foreground">
                          только чтение
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!loading && config && !config.error && section === "skills" && (
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">Навыки</h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCreateKind("skill")}
                  >
                    <Icon name="Plus" />
                    Новый навык
                  </Button>
                </div>
                {/* Режим — общий для раздела: применяется ко всем включённым
                    навыкам и к каждому включаемому. Отдельной строкой с подписью. */}
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Режим включённых навыков
                  </span>
                  <Dropdown
                    value={skillMode}
                    options={SKILL_MODE_OPTIONS}
                    disabled={false}
                    onChange={(mode) => {
                      setSkillMode(mode);
                      for (const skill of config.skills) {
                        if (skill.enabled) setSkill(skill.name, mode);
                      }
                    }}
                  />
                </div>
                {config.skills.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Навыков не найдено.
                  </p>
                )}
                <div className="space-y-0.5">
                  {config.skills.map((skill) => (
                    <div
                      key={skill.name}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-muted",
                        selectedName === skill.name && "bg-accent",
                        skill.dimmed && "opacity-60",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          skill.path
                            ? void openFile(skill.path)
                            : toast.error("Файл навыка не найден.")
                        }
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="truncate text-sm font-medium">
                          {skill.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {secondLine(
                            skill.tokens,
                            skill.origin === "project" ? "проектный" : "личный",
                          )}
                        </div>
                      </button>
                      <Switch
                        checked={skill.enabled}
                        // Включаем в общем режиме раздела, выключаем в off.
                        onChange={(next) =>
                          setSkill(skill.name, next ? skillMode : "off")
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!loading && config && !config.error && section === "agents" && (
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">Агенты</h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCreateKind("agent")}
                  >
                    <Icon name="Plus" />
                    Новый агент
                  </Button>
                </div>
                {config.agents.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Агентов не найдено.
                  </p>
                )}
                <div className="space-y-0.5">
                  {config.agents.map((agent) => (
                    <button
                      key={agent.path}
                      type="button"
                      onClick={() => void openFile(agent.path)}
                      className={cn(
                        "block w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted",
                        openDocPath === agent.path && "bg-accent",
                      )}
                    >
                      <div className="truncate text-sm font-medium">
                        {agent.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {secondLine(
                          agent.tokens,
                          agent.origin === "project" ? "проектный" : "личный",
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!loading && config && !config.error && section === "toolSearch" && (
              <div className={cn(config.toolSearch.dimmed && "opacity-60")}>
                <h2 className="mb-2 text-sm font-semibold">
                  Подгрузка инструментов
                </h2>
                <p className="mb-3 text-xs text-muted-foreground">
                  Схемы инструментов плагинов и MCP не грузятся в контекст все
                  сразу — виден лишь список имён, а полная схема подтягивается по
                  требованию, когда инструмент нужен. Экономит контекст, особенно
                  при многих MCP-серверах. «Всегда» — подгружать отложенно всегда;
                  «Автоматически» — только когда инструментов много; выкл —
                  грузить все схемы сразу.
                </p>
                <div className="flex shrink-0 items-center gap-3">
                  <Dropdown
                    value={config.toolSearch.mode}
                    options={TOOL_SEARCH_MODE_OPTIONS}
                    disabled={!config.toolSearch.enabled}
                    onChange={(mode) => setToolSearch(mode)}
                  />
                  <Switch
                    checked={config.toolSearch.enabled}
                    onChange={(next) =>
                      setToolSearch(next ? config.toolSearch.mode : "off")
                    }
                  />
                </div>
              </div>
            )}
              </div>
            </div>

            {/* Разделитель средней колонки и документ — остаток ширины. */}
            <ResizeHandle onPointerDown={startMidResize} />
            <div className="min-h-0 flex-1 overflow-hidden">
              {open ? (
                <DocTab subPath={subPath} />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Выберите элемент в списке
                </div>
              )}
            </div>
          </>
        ) : (
          // Ни файла, ни раздела — пустое состояние во всю ширину.
          <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
            Выберите раздел слева
          </div>
        )}
      </div>

      <CreateDialog
        open={createKind === "skill"}
        title="Новый навык"
        description="Создаст папку с SKILL.md и откроет его для правки."
        onClose={() => setCreateKind(null)}
        onCreate={createSkill}
      />
      <CreateDialog
        open={createKind === "agent"}
        title="Новый агент"
        description="Создаст файл агента и откроет его для правки."
        onClose={() => setCreateKind(null)}
        onCreate={createAgent}
      />
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "claude-config",
    title: "Claude Config",
    icon: "Brain",
    path: PANEL_PATH,
    component: ConfigPanel,
  });
});
