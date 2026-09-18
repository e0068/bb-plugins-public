// Куда ведёт ссылка результата этапа или артефакта. Агент присылает адрес,
// путь от корня дерева треда или абсолютный путь — чаще всего в хранилище
// треда, которое просмотрщик дерева не открывает.

export type ResultLink = { kind: "url"; url: string } | { kind: "workspace"; path: string } | { kind: "absolute"; path: string };

export const resultLink = (target: string): ResultLink =>
  /^https?:\/\//.test(target) ? { kind: "url", url: target } : target.startsWith("/") ? { kind: "absolute", path: target } : { kind: "workspace", path: target };

/** Где лежит хранилище треда; сервер узнаёт это у bb. */
export type StorageWhere = { threadId: string; hostId: string; storageRootPath: string };

export type FileTarget = { kind: "thread-storage"; threadId: string; path: string } | { kind: "host"; hostId: string; path: string };

/** Абсолютный путь внутри хранилища треда — файл хранилища от его корня, любой другой — файл хоста. */
export const fileTarget = (path: string, where: StorageWhere): FileTarget => {
  const root = where.storageRootPath.endsWith("/") ? where.storageRootPath : `${where.storageRootPath}/`;
  return path.startsWith(root) ? { kind: "thread-storage", threadId: where.threadId, path: path.slice(root.length) } : { kind: "host", hostId: where.hostId, path };
};
