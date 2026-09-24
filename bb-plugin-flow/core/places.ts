// Места исполнения, которые бриф предлагает владельцу, и маршрут нового треда:
// рабочее дерево и ветка. Новый тред бывает соседом этого (`thread`), дочерним
// (`child`) и заведённым в другом проекте bb (`other`). Сосед и дочерний на
// дерево и ветку не влияют — влияют только на родителя; чужой проект меняет и
// то, и другое: дерева этого треда там нет, а ветку задаёт сам проект.
// Новый worktree отдельным местом не предлагается —
// сервер его ещё понимает ради ответов, отправленных раньше, а читается он
// маршрутом «новое дерево, ветка от текущей».
import type { DispatchPlace, DispatchRoute, RouteBranch, RouteTree } from "../shared/contract";

export const OFFERED_PLACES = ["here", "thread", "child", "other"] as const satisfies readonly DispatchPlace[];

/** Запомненное место, которого нет в списке, открывается ближайшим предложенным: новый worktree — новым тредом. */
export const offeredPlace = (place: DispatchPlace): DispatchPlace => (place === "worktree" ? "thread" : place);

/** Работа уезжает из этого треда: новый тред соседом, дочерним, в новом дереве или в другом проекте. */
export const isNewThread = (place: DispatchPlace): place is Exclude<DispatchPlace, "here"> => place !== "here";

export const ROUTE_TREES = ["same", "new", "local"] as const satisfies readonly RouteTree[];

export const ROUTE_BRANCHES = ["current", "from-current", "from-origin-main", "from-main", "none"] as const satisfies readonly RouteBranch[];

export const DEFAULT_ROUTE: DispatchRoute = { tree: "same", branch: "current" };

/**
 * Ветки, возможные в дереве. В дереве треда можно остаться в текущей ветке и
 * можно отвести новую — дерево переедет на неё; без ветки дерева не бывает.
 * Новое дерево и чекаут проекта текущую ветку не возьмут — она уже занята
 * деревом треда, поэтому ветку они отводят; новое дерево без ветки bb не создаёт.
 */
const TREE_BRANCHES: Record<RouteTree, readonly RouteBranch[]> = {
  same: ["current", "from-current", "from-origin-main", "from-main"],
  new: ["from-current", "from-origin-main", "from-main"],
  local: ["from-current", "from-origin-main", "from-main", "none"],
};

/** Деревья чужого проекта: дерева этого треда там нет — оно принадлежит этому проекту. */
const OTHER_TREES = ["new", "local"] as const satisfies readonly RouteTree[];

/** В чужом проекте ветку не выбирают: новое дерево отводит её от ветки проекта, чекаут остаётся на своей. */
const OTHER_BRANCH: RouteBranch = "none";

export const treesFor = (place: DispatchPlace): readonly RouteTree[] => (place === "other" ? OTHER_TREES : ROUTE_TREES);

/** Маршрут возможен в этом месте: у чужого проекта ещё и проект должен быть выбран. */
export const routeAllowed = (place: DispatchPlace, route: DispatchRoute): boolean =>
  place === "other"
    ? (OTHER_TREES as readonly RouteTree[]).includes(route.tree) && route.branch === OTHER_BRANCH && route.projectId !== undefined
    : TREE_BRANCHES[route.tree].includes(route.branch);

/**
 * Маршрут, приведённый к месту: чужой проект берёт своё дерево и ветку и хранит
 * проект, своё место проект отбрасывает и чинит ветку под дерево.
 */
export const withPlace = (route: DispatchRoute, place: DispatchPlace): DispatchRoute => {
  if (place === "other") {
    const tree = (OTHER_TREES as readonly RouteTree[]).includes(route.tree) ? route.tree : "new";
    return { tree, branch: OTHER_BRANCH, ...(route.projectId === undefined ? {} : { projectId: route.projectId }) };
  }
  const branch = TREE_BRANCHES[route.tree].includes(route.branch) ? route.branch : TREE_BRANCHES[route.tree][0]!;
  return { tree: route.tree, branch };
};

export const withTree = (route: DispatchRoute, place: DispatchPlace, tree: RouteTree): DispatchRoute => withPlace({ ...route, tree }, place);

export const withBranch = (route: DispatchRoute, branch: RouteBranch): DispatchRoute =>
  TREE_BRANCHES[route.tree].includes(branch) ? { ...route, branch } : route;

export const withProject = (route: DispatchRoute, projectId: string): DispatchRoute => ({ ...route, projectId });

/**
 * Что показывает каждая колонка выбора места. Пустой список — колонки нет
 * вовсе, а не выключенные пункты. `tree` — дерево, которое в колонке отмечено:
 * оно же уедет в ответе, поэтому показанное и отправленное не расходятся.
 */
export type PlaceColumns = {
  places: readonly DispatchPlace[];
  trees: readonly RouteTree[];
  tree: RouteTree;
  branches: readonly RouteBranch[];
  /** Третья колонка — проекты вместо веток. */
  projects: boolean;
};

/**
 * Колонки слева направо. Первая ограничена только тем, что вообще существует:
 * «в другом проекте» предлагается, когда есть куда отправлять (`otherProjects`),
 * и остаётся в колонке, когда уже выбрано, — иначе выбор владельца пропал бы с
 * экрана, оставшись в ответе. Правее первой урезает выбор, сделанный левее.
 */
export const placeColumns = (place: DispatchPlace, route: DispatchRoute, otherProjects: boolean): PlaceColumns => {
  const places = OFFERED_PLACES.filter((id) => id !== "other" || otherProjects || place === "other");
  if (place === "here") return { places, trees: [], tree: route.tree, branches: [], projects: false };
  const trees = treesFor(place);
  const tree = trees.includes(route.tree) ? route.tree : "new";
  return place === "other" ? { places, trees, tree, branches: [], projects: true } : { places, trees, tree, branches: TREE_BRANCHES[tree], projects: false };
};

export const legacyRoute = (place: DispatchPlace): DispatchRoute => (place === "worktree" ? { tree: "new", branch: "from-current" } : DEFAULT_ROUTE);

/** `path` — путь дерева треда (`environment.path`); без него отвод ветки в этом дереве не делается. */
export type RouteSource = { environmentId: string; hostId: string; branchName: string | null; path?: string | null };

type ForkBranch = Exclude<RouteBranch, "current" | "none">;

const FIXED_BASE: Record<Exclude<ForkBranch, "from-current">, string> = { "from-origin-main": "origin/main", "from-main": "main" };

/** Окружение нового треда в форме `threads.spawn`: только это дерево читает одно окружение, остальные — хост. */
export const routeEnvironment = (place: DispatchPlace, route: DispatchRoute, source: RouteSource) => {
  if (place === "other") {
    // Дерево заводится в чужом проекте, поэтому хост берёт сам проект: хост этого треда тут ни при чём.
    // Чекаут проекта остаётся на своей ветке, новое дерево отводит её от ветки проекта по умолчанию.
    return route.tree === "local"
      ? { type: "host" as const, workspace: { type: "unmanaged" as const, path: null } }
      : { type: "host" as const, workspace: { type: "managed-worktree" as const, baseBranch: { kind: "default" as const } } };
  }
  const fork = route.branch === "current" || route.branch === "none" ? null : route.branch;
  if (route.tree === "same") {
    // Отвод в дереве треда выражается только чекаутом того же пути с новой веткой:
    // окружение `reuse` ветку не принимает, а сменить её у окружения bb нечем.
    const path = source.path ?? null;
    const base = fork === null ? null : fork === "from-current" ? source.branchName : FIXED_BASE[fork];
    return path === null || base === null
      ? { type: "reuse" as const, environmentId: source.environmentId }
      : { type: "host" as const, hostId: source.hostId, workspace: { type: "unmanaged" as const, path, branch: { kind: "new" as const, baseBranch: base } } };
  }
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
