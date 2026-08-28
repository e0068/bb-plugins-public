// bb-plugin-claude-config — панель: выбор области сверху и пять секций
// (хуки, плагины, коннекторы, навыки, подгрузка инструментов). Данные и запись
// — через RPC к server.ts; здесь только показ и переключение. Коннекторы .mcp.json
// переключаются тумблером; user/local и хуки — только просмотр (хук кликабелен,
// открывает своё содержимое во второй колонке).
//
// SKILL.md выбранного навыка (и любой открытый документ) показывается второй
// колонкой внутри самой панели — компонентом DocTab по тому же `subPath`
// маршрута (там и область, и имя), который панель уже получает. Раньше это была
// фиксированная вкладка в правой хостовой панели (experimental_fixedTabs), но в
// bb 0.40.0 navPanel с этой опцией не монтируется и пункт пропадает из сайдбара
// (см. задачу BP-53), поэтому содержимое перенесено в колонку.
import { useEffect, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  definePluginApp,
  Markdown,
  useBbNavigate,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import type { AreaConfig, rpcContract, WriteOutcome } from "./server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { MarkdownEditor } from "./packages/md-editor/react";
import {
  fileRefFromCode,
  isInTabLink,
  parseHref,
  resolveRelative,
} from "./packages/link-navigation/resolve";
import {
  ResizeHandle,
  useResizableWidth,
} from "./packages/resizable-pane/react";
import { ProjectSwitcher } from "./packages/project-switcher/react";
import { rankCandidates } from "./src/suggest";
import { extractCommandFile } from "./src/hook-script";
import "./doc-editor.css";

const PANEL_PATH = "claude-config";

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

// Markdown-файлы рендерим как есть; прочие (например plugin.json) — кодовым
// блоком с подсветкой по расширению, чтобы читалось, а не разъезжалось.
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
      <span
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-background shadow transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
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

function DocTab({ subPath }: PluginNavPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const target = parseDocSubPath(subPath);
  const areaId = target?.areaId ?? "";

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

  // Любой показ нового файла выходит из режима правки.
  const present = (result: Loaded) => {
    setDoc(result);
    setEditing(false);
    setSaveNote(null);
    setLoading(false);
    // Доп. хук-данные ставит только hook-ветка; для прочих документов сбрасываем.
    setHookExtra(null);
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
          // Манифест — JSON-блок, ниже — README как есть (если есть).
          const content =
            "```json\n" +
            (result.manifest ?? "") +
            "\n```" +
            (result.readme != null ? `\n\n---\n\n${result.readme}` : "");
          setComposite(true);
          present({
            path: result.manifestPath,
            content,
            error: null,
            sha256: null,
          });
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
  }, [subPath, rpc]);

  const openAbs = (abs: string) => {
    setLoading(true);
    setComposite(false);
    void rpc.call("readDoc", { areaId, path: abs }).then((result) => {
      setStack((prev) => [...prev, abs]);
      present(result);
    });
  };

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
          <div className="p-4" onClick={onCompositeClick}>
            <Markdown content={doc.content} />
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
          <div className="h-full p-4" onClick={onDocClick}>
            <MarkdownEditor
              editable={editing}
              atLinks
              value={editing ? draft : asMarkdown(doc.path, doc.content)}
              onChange={setDraft}
              linkResolver={linkResolver}
              pathProvider={pathProvider}
              onSave={(md) => {
                setDraft(md);
                save(md);
              }}
              className="h-full cc-doc-mde"
            />
          </div>
        )}
      </div>
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

  // Что открыто во второй колонке (для подсветки), если относится к этой области.
  const open = parseDocSubPath(subPath);
  const { width: docWidth, startResize } = useResizableWidth({
    initial: 420,
    min: 320,
    max: 900,
    storageKey: "claude-config:doc-pane-width",
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
  const openSkill = (name: string) =>
    navigate.toPluginPanel(PANEL_PATH, { subPath: skillSubPath(areaId, name) });
  const openDoc = (path: string) =>
    navigate.toPluginPanel(PANEL_PATH, { subPath: docSubPath(areaId, path) });
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

  return (
    <div className="flex h-full min-h-0">
      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
      <div className="mx-auto w-full max-w-3xl space-y-4">
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
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {notice}
          </div>
        )}

        {loading && <p className="text-sm text-muted-foreground">Загрузка…</p>}

        {!loading && config?.error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Файл {config.error.file} не разобрать: {config.error.message}
          </div>
        )}

        {!loading && config && !config.error && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Хуки</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {config.hooks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Хуков не найдено.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Тумблер выключает хук — Claude Code его не отключает сам,
                    поэтому панель вырезает хук в своё хранилище и возвращает
                    при включении. Клик по строке открывает и правит команду.
                  </p>
                )}
                {config.hooks.map((hook) => {
                  const infoContent = (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {hook.event}
                        </span>
                        {hook.matcher && (
                          <span className="text-xs text-muted-foreground">
                            matcher: {hook.matcher}
                          </span>
                        )}
                        <span className="ml-auto text-xs text-muted-foreground">
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
                        "flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2 transition-opacity last:border-0 last:pb-0",
                        !hook.enabled && "opacity-60",
                      )}
                    >
                      {hook.enabled ? (
                        <button
                          type="button"
                          onClick={() =>
                            openHook(hook.origin, hook.index, hook.event)
                          }
                          className={cn(
                            "min-w-0 flex-1 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted",
                            selectedHook?.origin === hook.origin &&
                              selectedHook?.index === hook.index &&
                              selectedHook?.event === hook.event &&
                              "bg-muted",
                          )}
                        >
                          {infoContent}
                        </button>
                      ) : (
                        <div className="min-w-0 flex-1 px-2 py-1">
                          {infoContent}
                        </div>
                      )}
                      <Switch
                        checked={hook.enabled}
                        onChange={(next) => setHookEnabled(hook, next)}
                      />
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {memory.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Память</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {memory.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      title={entry.path}
                      onClick={() => openDoc(entry.path)}
                      className={cn(
                        "rounded-md border border-border px-2 py-1 text-sm transition-colors hover:bg-muted",
                        openDocPath === entry.path && "bg-muted",
                      )}
                    >
                      {entry.label}
                    </button>
                  ))}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Плагины Claude Code</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {config.plugins.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Установленных плагинов не найдено.
                  </p>
                )}
                {config.plugins.map((plugin) => (
                  <div
                    key={plugin.key}
                    className={cn(
                      "flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2 transition-opacity last:border-0 last:pb-0",
                      // В проекте строка «как глобально» приглушена; отличие —
                      // на полной непрозрачности.
                      plugin.dimmed && "opacity-60",
                    )}
                  >
                    {plugin.installPath ? (
                      <button
                        type="button"
                        onClick={() => openPlugin(plugin.key)}
                        className={cn(
                          "min-w-0 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted",
                          selectedPluginKey === plugin.key && "bg-muted",
                        )}
                      >
                        <div className="truncate text-sm font-medium">
                          {plugin.name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {plugin.marketplace}
                          {plugin.version ? ` · ${plugin.version}` : ""}
                        </div>
                      </button>
                    ) : (
                      <div className="min-w-0 px-2 py-1">
                        <div className="truncate text-sm font-medium">
                          {plugin.name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {plugin.marketplace}
                          {plugin.version ? ` · ${plugin.version}` : ""}
                        </div>
                      </div>
                    )}
                    <Switch
                      checked={plugin.value}
                      onChange={(next) => setPlugin(plugin.key, next)}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Коннекторы</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {config.connectors.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Коннекторов не найдено.
                  </p>
                )}
                {config.connectors.map((connector) => (
                  <div
                    key={`${connector.origin}:${connector.name}`}
                    className={cn(
                      "flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2 transition-opacity last:border-0 last:pb-0",
                      connector.dimmed && "opacity-60",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        openConnector(connector.origin, connector.name)
                      }
                      className={cn(
                        "min-w-0 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted",
                        selectedConnector?.name === connector.name &&
                          selectedConnector?.origin === connector.origin &&
                          "bg-muted",
                      )}
                    >
                      <div className="truncate text-sm font-medium">
                        {connector.name}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {connectorSubtitle(connector.origin, connector.transport)}
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
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Навыки</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {config.skills.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Навыков не найдено.
                  </p>
                )}
                {config.skills.map((skill) => (
                  <div
                    key={skill.name}
                    className={cn(
                      "flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2 transition-opacity last:border-0 last:pb-0",
                      skill.dimmed && "opacity-60",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => openSkill(skill.name)}
                      className={cn(
                        "min-w-0 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted",
                        selectedName === skill.name && "bg-muted",
                      )}
                    >
                      <div className="truncate text-sm font-medium">
                        {skill.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {skill.origin === "project" ? "проектный" : "личный"}
                      </div>
                    </button>
                    <div className="flex items-center gap-3">
                      {/* Список слева от тоггла; при выключенном навыке недоступен. */}
                      <Dropdown
                        value={skill.mode}
                        options={SKILL_MODE_OPTIONS}
                        disabled={!skill.enabled}
                        onChange={(mode) => setSkill(skill.name, mode)}
                      />
                      <Switch
                        checked={skill.enabled}
                        // Включаем в текущем режиме списка, выключаем в off.
                        onChange={(next) =>
                          setSkill(skill.name, next ? skill.mode : "off")
                        }
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Подгрузка инструментов</CardTitle>
              </CardHeader>
              <CardContent
                className={cn(
                  "flex flex-wrap items-center justify-between gap-3 transition-opacity",
                  config.toolSearch.dimmed && "opacity-60",
                )}
              >
                <p className="max-w-md text-xs text-muted-foreground">
                  Схемы инструментов плагинов и MCP не грузятся в контекст все
                  сразу — виден лишь список имён, а полная схема подтягивается по
                  требованию, когда инструмент нужен. Экономит контекст, особенно
                  при многих MCP-серверах. «Всегда» — подгружать отложенно
                  всегда; «Автоматически» — только когда инструментов много;
                  выкл — грузить все схемы сразу.
                </p>
                <div className="flex items-center gap-3">
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
              </CardContent>
            </Card>
          </>
        )}
      </div>
      </div>
      {open && (
        <>
          <ResizeHandle onPointerDown={startResize} />
          <div
            style={{ width: docWidth }}
            className="h-full min-h-0 shrink-0 overflow-hidden"
          >
            <DocTab subPath={subPath} />
          </div>
        </>
      )}
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
