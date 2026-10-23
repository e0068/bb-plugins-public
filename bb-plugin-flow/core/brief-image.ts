// Картинка в тексте брифа — `![подпись](docs/снимок.jpg)`. Путь идёт от корня дерева треда, а браузер файлов хоста не
// видит: движок текста без адреса рисует вместо снимка плашку «подпись — путь». Адрес даёт маршрут сервера Flow, он
// читает файл из дерева того треда, чей бриф. Отдаются только растровые картинки внутри дерева.
import { bareHref } from "./inline-links";
import { OWN_PLUGIN_ID } from "./plugin-id";

export const BRIEF_IMAGE_PATH = "/brief-image";

const IMAGE_TYPES: Readonly<Partial<Record<string, string>>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
};

/** Тип растровой картинки по расширению; не картинка или svg (в нём бывает скрипт) — `null`. */
export const imageType = (path: string): string | null => {
  const ext = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase();
  return ext === undefined ? null : (IMAGE_TYPES[ext] ?? null);
};

/** Адрес снимка для движка текста; путь не картинка — `null`, и движок оставляет плашку. */
export const briefImageUrl = (threadId: string, raw: string): string | null => {
  const src = bareHref(raw);
  return imageType(src) === null ? null : `/api/v1/plugins/${OWN_PLUGIN_ID}/http${BRIEF_IMAGE_PATH}?${new URLSearchParams({ thread: threadId, src }).toString()}`;
};

/** Снимок в дереве: путь от корня без `.` и `..` и тип картинки. */
export type TreeImage = { path: string; type: string };

/** Снимок по пути из текста; путь абсолютный, уходит из дерева или не картинка — `null`. */
export const treeImage = (src: string): TreeImage | null => {
  const type = imageType(src);
  if (src.startsWith("/") || type === null) return null;
  const parts: string[] = [];
  for (const part of src.split("/")) {
    if (part === "" || part === ".") continue;
    if (part !== "..") parts.push(part);
    else if (parts.pop() === undefined) return null;
  }
  return { path: parts.join("/"), type };
};

/**
 * Файл снимка на диске; пустой корень — `null`, а не путь от корня диска. Ссылки файловой системы нормализация не
 * раскрывает: настоящая граница — корень дерева, с которым хост читает файл.
 */
export const inTree = (root: string, image: TreeImage): string | null => (root === "" ? null : `${root.replace(/\/+$/, "")}/${image.path}`);

/** Абсолютный путь снимка в дереве треда; путь абсолютный, уходит из дерева или не картинка — `null`. */
export const workspaceImage = (root: string, src: string): string | null => {
  const image = treeImage(src);
  return image === null ? null : inTree(root, image);
};
