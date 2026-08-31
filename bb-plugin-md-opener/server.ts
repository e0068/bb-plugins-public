// bb-plugin-md-opener — бэкенд слота fileOpener. Слой проводки: резолвит
// источник вкладки в хост+корень (src/opener-source), читает файл с confine по
// корню, попутно размечает ссылки тела на «живые» (существующие) и отдаёт всё
// одним ответом; пишет правку с CAS. Логика разбора ссылок — в чистых слоях
// (src/opener-links + общий packages/link-navigation), здесь только bb-I/O.
import { homedir } from "node:os";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

import {
  parseHref,
  resolveRelative,
} from "./packages/link-navigation/resolve";
// Прямой импорт чистого модуля (не barrel index): иначе сервер потянул бы
// React-компонент MdDocView и его CSS в серверный бандл.
import { descriptors as kasimovDescriptors } from "./packages/md-doc-view/kasimov-settings";
import { extractLinkHrefs } from "./src/opener-links";
import { resolveSource, type OpenerSource } from "./src/opener-source";

// НЕ strict: хост в объекте source может нести поля сверх типизированных —
// strict отверг бы их, и RPC упал бы до хендлера («Failed to load file»).
// Лишнее просто отбрасываем, читаем только нужные четыре поля.
const sourceSchema = z.object({
  kind: z.enum(["host", "thread-storage", "workspace"]),
  threadId: z.string().nullable(),
  environmentId: z.string().nullable(),
  projectId: z.string().nullable(),
});

// Ссылка тела: href как в разметке, abs — резолв сервера (единый с фронтом),
// exists — существует ли цель на хосте. Фронт берёт abs отсюда, не резолвя `~`
// сам (см. computeLinks).
const linkSchema = z.object({
  href: z.string(),
  abs: z.string(),
  exists: z.boolean(),
});

const docOutput = z.object({
  path: z.string(),
  content: z.string().nullable(),
  error: z.string().nullable(),
  sha256: z.string().nullable(),
  links: z.array(linkSchema),
});

export type DocContent = z.infer<typeof docOutput>;
export type DocLink = z.infer<typeof linkSchema>;

export const rpcContract = defineRpcContract({
  readDoc: {
    // path: относительный (workspace/thread-storage) при первом открытии либо
    // абсолютный при прыжке по ссылке. source — непрозрачный токен вкладки,
    // резолв корня/хоста делает сервер.
    input: z.object({ path: z.string(), source: sourceSchema }).strict(),
    output: docOutput,
  },
  writeDoc: {
    // CAS-запись: expectedSha256 из readDoc. sha256 при успехе — новый.
    input: z
      .object({
        path: z.string(),
        source: sourceSchema,
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

// --- чистые path-хелперы (server-side, node-free кроме homedir) --------------

function joinPath(dir: string, rel: string): string {
  return dir.endsWith("/") ? `${dir}${rel}` : `${dir}/${rel}`;
}

function dirOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "/" : path.slice(0, idx);
}

function baseOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

function isWithin(root: string, target: string): boolean {
  if (target === root) return true;
  return target.startsWith(root.endsWith("/") ? root : `${root}/`);
}

/** Раскрывает ведущий `~` в домашний каталог хоста сервера (для `~/…`-ссылок). */
function expandTilde(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return joinPath(homedir(), path.slice(2));
  return path;
}

/**
 * Абсолютный путь документа из входного `path`: host — уже абсолютный (после
 * раскрытия `~`); иначе относительный клеим к корню (абсолютный, пришедший
 * прыжком, оставляем как есть — фенс проверит вызывающий).
 */
function toAbsolute(
  source: OpenerSource,
  root: string | undefined,
  path: string,
): string {
  const expanded = expandTilde(path);
  if (source.kind === "host") return expanded;
  if (expanded.startsWith("/")) return expanded;
  return root ? joinPath(root, expanded) : expanded;
}

export default function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  // Свои (раздельные) настройки Kasimov: кегли/отступы/цвета/шрифты + флаги.
  // Схема общая с Cloud Config (packages/md-doc-view/kasimov-settings), но
  // значения этого плагина независимы. Фронт читает их через useSettings.
  bb.settings.define(kasimovDescriptors);

  // Чтение файла: отсутствие — пустой результат (text=null), не исключение.
  async function readFile(
    path: string,
    hostId: string | undefined,
    rootPath: string | undefined,
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

  /**
   * Размечает ссылки тела на живые. abs каждой ссылки резолвится тем же
   * resolveRelative, что и во фронте (после раскрытия `~`) — чтобы стороны
   * сошлись. Существование берём листингом папок (по одному listPaths на
   * папку, не чтением файлов); для не-host папки вне корня в листинг не идут.
   */
  async function computeLinks(
    body: string,
    docAbs: string,
    hostId: string | undefined,
    root: string | undefined,
  ): Promise<DocLink[]> {
    const entries = extractLinkHrefs(body).map((href) => {
      const raw = expandTilde(parseHref(href).path);
      return { href, abs: resolveRelative(docAbs, raw) };
    });
    if (entries.length === 0) return [];

    const namesByDir = new Map<string, Set<string> | null>();
    const dirs = new Set(entries.map((e) => dirOf(e.abs)));
    for (const dir of dirs) {
      if (root && !isWithin(root, dir)) {
        namesByDir.set(dir, null); // вне корня — не листаем, считаем мёртвыми
        continue;
      }
      try {
        const listing = await bb.sdk.files.listPaths({
          path: dir,
          hostId,
          includeFiles: true,
          includeDirectories: true,
          limit: 5000,
        });
        namesByDir.set(dir, new Set(listing.paths.map((p) => p.name)));
      } catch {
        namesByDir.set(dir, null);
      }
    }

    return entries.map(({ href, abs }) => ({
      href,
      abs,
      exists: namesByDir.get(dirOf(abs))?.has(baseOf(abs)) ?? false,
    }));
  }

  bb.rpc.register(rpcContract, {
    async readDoc({ path, source }) {
      try {
        return await doRead(path, source);
      } catch (err) {
        bb.log.error(`readDoc failed: ${String(err)}`);
        return {
          path,
          content: null,
          error: `Не удалось прочитать: ${String(err)}`,
          sha256: null,
          links: [],
        };
      }
    },

    async writeDoc(input) {
      try {
        return await doWrite(input);
      } catch (err) {
        bb.log.error(`writeDoc failed: ${String(err)}`);
        return {
          outcome: "denied" as const,
          sha256: null,
          message: `Не удалось сохранить: ${String(err)}`,
        };
      }
    },
  });

  async function doRead(path: string, source: OpenerSource): Promise<DocContent> {
    const resolved = await resolveSource(bb, source);
    if (!resolved) {
      return {
        path: "",
        content: null,
        error: "Источник вкладки недоступен.",
        sha256: null,
        links: [],
      };
    }
    const abs = toAbsolute(source, resolved.root, path);
    if (resolved.root && !isWithin(resolved.root, abs)) {
      return {
        path: abs,
        content: null,
        error: "Путь вне корня источника.",
        sha256: null,
        links: [],
      };
    }
    const { text, sha256 } = await readFile(abs, resolved.hostId, resolved.root);
    if (text === null) {
      return {
        path: abs,
        content: null,
        error: "Файл не найден.",
        sha256: null,
        links: [],
      };
    }
    const links = await computeLinks(text, abs, resolved.hostId, resolved.root);
    return { path: abs, content: text, error: null, sha256, links };
  }

  async function doWrite(input: {
    path: string;
    source: OpenerSource;
    content: string;
    expectedSha256: string | null;
  }): Promise<{
    outcome: "written" | "conflict" | "denied" | "not-found";
    sha256: string | null;
    message: string | null;
  }> {
    const { path, source, content, expectedSha256 } = input;
    const resolved = await resolveSource(bb, source);
    if (!resolved) {
      return {
        outcome: "not-found",
        sha256: null,
        message: "Источник вкладки недоступен.",
      };
    }
    const abs = toAbsolute(source, resolved.root, path);
    if (resolved.root && !isWithin(resolved.root, abs)) {
      return {
        outcome: "denied",
        sha256: null,
        message: "Путь вне корня источника.",
      };
    }
    const written = await bb.sdk.files.write({
      path: abs,
      hostId: resolved.hostId,
      rootPath: resolved.root,
      content,
      expectedSha256,
    });
    if (written.outcome === "conflict") {
      return {
        outcome: "conflict",
        sha256: written.currentSha256,
        message: "Файл изменился на диске. Обновите и повторите.",
      };
    }
    return { outcome: "written", sha256: written.sha256, message: null };
  }
}
