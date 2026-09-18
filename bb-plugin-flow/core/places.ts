// Места исполнения, которые бриф предлагает владельцу, и маршрут нового треда:
// рабочее дерево и ветка. Новый worktree отдельным местом не предлагается —
// сервер его ещё понимает ради ответов, отправленных раньше, а читается он
// маршрутом «новое дерево, ветка от текущей».
import type { DispatchPlace, DispatchRoute, RouteBranch, RouteTree } from "../shared/contract";

export const OFFERED_PLACES = ["here", "thread"] as const satisfies readonly DispatchPlace[];

/** Запомненное место, которого нет в списке, открывается ближайшим предложенным: новый worktree — новым тредом. */
export const offeredPlace = (place: DispatchPlace): DispatchPlace => (place === "worktree" ? "thread" : place);

export const ROUTE_TREES = ["same", "new", "local"] as const satisfies readonly RouteTree[];

export const ROUTE_BRANCHES = ["current", "from-current", "from-origin-main", "from-main", "none"] as const satisfies readonly RouteBranch[];

export const DEFAULT_ROUTE: DispatchRoute = { tree: "same", branch: "current" };

/**
 * Ветки, возможные в дереве. Это же дерево живёт в текущей ветке. Новое дерево
 * и чекаут проекта текущую ветку не возьмут — она уже занята деревом треда,
 * поэтому ветку они отводят; новое дерево без ветки bb не создаёт.
 */
const TREE_BRANCHES: Record<RouteTree, readonly RouteBranch[]> = {
  same: ["current"],
  new: ["from-current", "from-origin-main", "from-main"],
  local: ["from-current", "from-origin-main", "from-main", "none"],
};

export const branchAllowed = (tree: RouteTree, branch: RouteBranch): boolean => TREE_BRANCHES[tree].includes(branch);

export const withTree = (route: DispatchRoute, tree: RouteTree): DispatchRoute => ({ tree, branch: branchAllowed(tree, route.branch) ? route.branch : TREE_BRANCHES[tree][0]! });

export const withBranch = (route: DispatchRoute, branch: RouteBranch): DispatchRoute => (branchAllowed(route.tree, branch) ? { ...route, branch } : route);

export const legacyRoute = (place: DispatchPlace): DispatchRoute => (place === "worktree" ? { tree: "new", branch: "from-current" } : DEFAULT_ROUTE);

export type RouteSource = { environmentId: string; hostId: string; branchName: string | null };

type ForkBranch = Exclude<RouteBranch, "current" | "none">;

const FIXED_BASE: Record<Exclude<ForkBranch, "from-current">, string> = { "from-origin-main": "origin/main", "from-main": "main" };

/** Окружение нового треда в форме `threads.spawn`: только это дерево читает одно окружение, остальные — хост. */
export const routeEnvironment = (route: DispatchRoute, source: RouteSource) => {
  if (route.tree === "same") return { type: "reuse" as const, environmentId: source.environmentId };
  const fork = route.branch === "current" || route.branch === "none" ? null : route.branch;
  if (route.tree === "new") {
    // Ветка нового дерева отводится от ветки исходного треда: иначе работа, сделанная в ней, новому треду не видна.
    const base = fork === null || fork === "from-current" ? source.branchName : FIXED_BASE[fork];
    const baseBranch = base === null ? ({ kind: "default" } as const) : ({ kind: "named", name: base } as const);
    return { type: "host" as const, hostId: source.hostId, workspace: { type: "managed-worktree" as const, baseBranch } };
  }
  const base = fork === null ? null : fork === "from-current" ? source.branchName : FIXED_BASE[fork];
  return {
    type: "host" as const,
    hostId: source.hostId,
    workspace: { type: "unmanaged" as const, path: null, ...(base === null ? {} : { branch: { kind: "new" as const, baseBranch: base } }) },
  };
};
