import type { CallerEnvironment } from "./caller-root.js";

/**
 * Тред, работающий в своём дереве, и задачи этого дерева, к которым он
 * привязан. Задача, созданная в ветке, до слияния живёт только там, а доска
 * без треда читает main (BP-187), — поэтому Active и Waiting узнают о ней
 * отсюда: дерево читается точечно, ровно эти слаги, а не обходом всех
 * деревьев (decisions/tasks-plus-board-roots-blocks-rpc.md).
 */
export interface BranchThread {
  threadId: string;
  environment: CallerEnvironment;
  slugs: readonly string[];
}

/** Ключ KV, под которым память о тредах веток переживает перезапуск плагина:
 *  о треде, который уже работает, событий больше не придёт. */
export const BRANCH_THREADS_KEY = "branchThreads";

/** Своё дерево на диске — без него читать нечего. */
export function hasOwnTree(environment: CallerEnvironment | null): environment is CallerEnvironment {
  return environment !== null && environment.isWorktree && environment.path !== null;
}

/** Тред с ещё одним слагом; повторная привязка ничего не добавляет. */
export function withBranchSlug(
  previous: BranchThread | undefined,
  threadId: string,
  environment: CallerEnvironment,
  slug: string,
): BranchThread {
  const slugs = previous?.slugs ?? [];
  return { threadId, environment, slugs: slugs.includes(slug) ? slugs : [...slugs, slug] };
}

/** Треды, разложенные по деревьям: одно чтение дерева на всех его тредов. */
export function byEnvironment(threads: readonly BranchThread[]): BranchThread[][] {
  const groups = new Map<string, BranchThread[]>();
  for (const thread of threads) {
    const id = thread.environment.environmentId;
    groups.set(id, [...(groups.get(id) ?? []), thread]);
  }
  return [...groups.values()];
}

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function parseEnvironment(raw: unknown): CallerEnvironment | null {
  if (typeof raw !== "object" || raw === null) return null;
  const e = raw as Record<string, unknown>;
  if (!isText(e.environmentId) || !isText(e.projectId) || !isText(e.hostId)) return null;
  if (typeof e.isWorktree !== "boolean") return null;
  const nullableText = (value: unknown) => (isText(value) ? value : null);
  return {
    environmentId: e.environmentId,
    projectId: e.projectId,
    path: nullableText(e.path),
    name: nullableText(e.name),
    branchName: nullableText(e.branchName),
    isWorktree: e.isWorktree,
    hostId: e.hostId,
  };
}

/** Записи из KV; запись, которую не разобрать, отбрасывается, а не роняет
 *  загрузку: худшее, что из-за неё случится, — задача ветки не видна до
 *  следующего события её треда. */
export function parseBranchThreads(raw: unknown): BranchThread[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): BranchThread[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const e = entry as Record<string, unknown>;
    const environment = parseEnvironment(e.environment);
    if (!isText(e.threadId) || !hasOwnTree(environment) || !Array.isArray(e.slugs)) return [];
    return [{ threadId: e.threadId, environment, slugs: e.slugs.filter(isText) }];
  });
}
