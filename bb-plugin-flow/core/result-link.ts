// Куда ведёт ссылка результата этапа или артефакта. Агент присылает адрес,
// путь от корня дерева треда или абсолютный путь — чаще всего в хранилище
// треда, которое просмотрщик дерева не открывает.

export type ResultLink = { kind: "url"; url: string } | { kind: "workspace"; path: string } | { kind: "absolute"; path: string };

export const resultLink = (target: string): ResultLink =>
  /^https?:\/\//.test(target) ? { kind: "url", url: target } : target.startsWith("/") ? { kind: "absolute", path: target } : { kind: "workspace", path: target };

/** Где лежит хранилище треда; сервер узнаёт это у bb. */
export type StorageWhere = { threadId: string; hostId: string; storageRootPath: string };

export type FileTarget = { kind: "thread-storage"; threadId: string; path: string } | { kind: "host"; hostId: string; path: string };

/** Файл, который bb открывает сам: превью по клику, меню «Open in / Open with / Copy path» по правому клику. */
export type LiveTarget = FileTarget | { kind: "workspace"; environmentId: string; path: string };

/** Корни файлов треда: окружение — для путей от корня дерева, хранилище — для абсолютных; нет корня — `null`. */
export type FileRoots = { threadId: string; environmentId: string | null; storage: { hostId: string; storageRootPath: string } | null };

export type LiveLink = { kind: "url"; url: string } | { kind: "file"; target: LiveTarget } | { kind: "none" };

/** Абсолютный путь внутри хранилища треда — файл хранилища от его корня, любой другой — файл хоста. */
export const fileTarget = (path: string, where: StorageWhere): FileTarget => {
  const root = where.storageRootPath.endsWith("/") ? where.storageRootPath : `${where.storageRootPath}/`;
  return path.startsWith(root) ? { kind: "thread-storage", threadId: where.threadId, path: path.slice(root.length) } : { kind: "host", hostId: where.hostId, path };
};

/** Живая цель ссылки результата; корней ещё нет (`null`) или нужного корня нет — открыть нечем. */
export const liveLink = (target: string, roots: FileRoots | null): LiveLink => {
  const link = resultLink(target);
  if (link.kind === "url") return link;
  if (link.kind === "workspace")
    return roots?.environmentId == null ? { kind: "none" } : { kind: "file", target: { kind: "workspace", environmentId: roots.environmentId, path: link.path } };
  return roots?.storage == null ? { kind: "none" } : { kind: "file", target: fileTarget(link.path, { threadId: roots.threadId, ...roots.storage }) };
};

/**
 * Строка успеха шага автоматизации: адрес PR открывается, остальное — тема
 * коммита, ключи переведённых задач, «no linked tasks» — читается текстом.
 * Схема из подписи убрана: в ряду шагов её длины всё равно не хватает.
 */
export type StepDetail = { kind: "link"; url: string; label: string } | { kind: "text"; text: string };

export const stepDetail = (detail: string | null | undefined): StepDetail | null => {
  const text = detail?.trim() ?? "";
  if (text === "") return null;
  const link = resultLink(text);
  return link.kind === "url" ? { kind: "link", url: link.url, label: link.url.replace(/^https?:\/\//, "") } : { kind: "text", text };
};
