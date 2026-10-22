// Слой 3 — какие плагины вернуть из рабочей копии треда в основную копию проекта. Живое превью ставит плагин из
// дерева треда (`path:`); после архива треда это дерево удаляется, и плагин остаётся без папки. bb переносит плагин
// между `path:` без потерь — настройки, секреты и расписания остаются, — поэтому возврат — та же установка из
// основной копии. Мир — список плагинов, корни проектов и какие папки есть — приходит аргументом;
// server/plugin-homecoming.ts его читает и ставит.

/** Плагин так, как его держит bb. */
export interface HeldPlugin {
  readonly id: string;
  readonly source: string;
}

/** Повод сверки: архив одного треда — или запуск Flow, когда архив мог пройти без него. */
export type HomecomingTrigger = { readonly kind: "archived"; readonly threadId: string } | { readonly kind: "startup" };

export interface HomecomingFacts {
  readonly plugins: readonly HeldPlugin[];
  /** Папки основных копий проектов bb. */
  readonly projectRoots: readonly string[];
  /** Какие из нужных сверке папок есть на диске: папки установок из деревьев и кандидаты в основной копии. */
  readonly existing: ReadonlySet<string>;
  readonly trigger: HomecomingTrigger;
  /** Этот плагин: его переустановка гасит обработчик, поэтому он идёт последним. */
  readonly ownPluginId: string;
}

export interface Homecoming {
  readonly pluginId: string;
  readonly from: string;
  readonly to: string;
}

/** Установка из дерева треда: `…/worktrees/<тред>-<n>/<папка репозитория>/<путь плагина>`. */
interface TreeInstall {
  readonly pluginId: string;
  readonly from: string;
  readonly threadId: string;
  readonly repoDir: string;
  readonly inner: string;
}

const TREE_PATH = /^path:(.*\/worktrees\/(thr_[A-Za-z0-9]+)-\d+\/([^/]+)\/(.+?))\/?$/;

const baseName = (path: string): string => path.replace(/\/+$/, "").split("/").pop() ?? "";

/** Плагин, установленный из дерева треда; любой другой источник — `null`. */
export const treeInstall = ({ id, source }: HeldPlugin): TreeInstall | null => {
  const match = TREE_PATH.exec(source);
  return match === null ? null : { pluginId: id, from: match[1]!, threadId: match[2]!, repoDir: match[3]!, inner: match[4]! };
};

/** Та же папка плагина в основных копиях проектов, чья папка называется как папка репозитория в дереве. */
export const homeCandidates = (install: TreeInstall, projectRoots: readonly string[]): string[] =>
  projectRoots.filter((root) => baseName(root) === install.repoDir).map((root) => `${root.replace(/\/+$/, "")}/${install.inner}`);

/** Архив возвращает плагины своего треда; запуск — те, чьей папки в дереве уже нет. */
const due = (install: TreeInstall, trigger: HomecomingTrigger, existing: ReadonlySet<string>): boolean =>
  trigger.kind === "archived" ? install.threadId === trigger.threadId : !existing.has(install.from);

/**
 * Ставить ли зависимости плагина заново перед установкой: bb собирает `path:`-установку из node_modules самой папки,
 * а мёрдж, добавивший пакет, двигает package-lock.json без `npm ci`. Аргументы — время правки lock и отметки
 * установки `node_modules/.package-lock.json`; нет файла — `null`.
 */
export const depsStale = (lockMtime: number | null, installedMtime: number | null): boolean =>
  lockMtime !== null && (installedMtime === null || lockMtime > installedMtime);

/** Разобранный lock-файл npm: пакеты под ключами `node_modules/…`. */
export interface NpmLock {
  readonly packages?: Readonly<Record<string, { readonly optional?: boolean }>>;
}

/**
 * Неполна ли установка: в `node_modules/.package-lock.json` нет пакета из package-lock.json — так выглядит установка
 * без dev-пакетов, хоть она и свежее lock. Необязательные пакеты не требуются: npm не ставит те, что под чужую
 * платформу. Аргументы — разобранные lock-файлы, `null` — файла нет.
 */
export const depsIncomplete = (lock: NpmLock | null, installed: NpmLock | null): boolean =>
  lock !== null &&
  (installed === null ||
    Object.entries(lock.packages ?? {}).some(([key, entry]) => key.startsWith("node_modules/") && entry.optional !== true && !(key in (installed.packages ?? {}))));

/** Плагины, которые пора вернуть в основную копию; плагин, которого там нет, остаётся, где стоял. */
export function planHomecoming({ plugins, projectRoots, existing, trigger, ownPluginId }: HomecomingFacts): Homecoming[] {
  const moves = plugins.flatMap((plugin) => {
    const install = treeInstall(plugin);
    if (install === null || !due(install, trigger, existing)) return [];
    const to = homeCandidates(install, projectRoots).find((path) => existing.has(path));
    return to === undefined ? [] : [{ pluginId: install.pluginId, from: install.from, to }];
  });
  return [...moves.filter((m) => m.pluginId !== ownPluginId), ...moves.filter((m) => m.pluginId === ownPluginId)];
}
