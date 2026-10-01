// Layer: shell, pure. Which list or board the header and the Display panel
// control on a route — one answer for both, so they never disagree.
import type { SavedView } from "../shared/contract.js";
import type { TaskLayout } from "../shared/enums.js";
import type { ResolvedTasksRoute, TasksRoute } from "../client/routes.js";
import { listPreferenceScope } from "../views/common/list-preference.js";
import type { ViewTarget } from "../views/common/view-state.js";

/**
 * A saved view's target: its own scope (a project's list, or a cross-project
 * surface — a board is no longer only a project's), with the layout this
 * client last picked for the view, if any, else the view's own surface.
 * `layoutOf` is a pure lookup handed in by the caller so this unit stays free
 * of storage — it must answer `undefined` for a key never written, not the
 * generic screen default: a fresh board view opens as a board, not a table.
 */
function savedViewTarget(view: SavedView, layoutOf: (key: string) => TaskLayout | null): ViewTarget {
  return {
    layout: layoutOf(`view:${view.id}`) ?? view.surface,
    scope: listPreferenceScope(view.projectId, view.listScope),
    view,
  };
}

/** The list or board a route shows; null where there is none — a task, Manage, Analytics, a view not loaded or gone. */
export function viewTargetOf(
  route: ResolvedTasksRoute,
  savedViews: readonly SavedView[] | undefined,
  layoutOf: (key: string) => TaskLayout | null,
): ViewTarget | null {
  switch (route.kind) {
    case "all":
      return { layout: route.view, scope: "all", view: null };
    case "active":
      return { layout: route.view, scope: "active", view: null };
    case "waiting":
      return { layout: route.view, scope: "waiting", view: null };
    case "project":
      return { layout: route.view, scope: `project:${route.projectId}`, view: null };
    case "view": {
      const view = savedViews?.find((entry) => entry.id === route.savedViewId);
      return view === undefined ? null : savedViewTarget(view, layoutOf);
    }
    case "task":
    case "manage":
    case "analytics":
      return null;
  }
}

/**
 * The view-preference key a route's own screen remembers its layout under —
 * `all`, `active`, `waiting`, `project:<id>` — or null for a route with no
 * screen layout of its own: a task, Manage, Analytics, a saved view (a view's
 * layout is keyed by `view:<id>`, written directly by its own caller). The
 * one place that spells out which route kinds are a screen, so `resolveRoute`
 * and the navigation wrapper in app-shell.tsx read the same list instead of
 * each repeating it.
 */
export function layoutKeyOf(route: TasksRoute | ResolvedTasksRoute): string | null {
  switch (route.kind) {
    case "all":
      return "all";
    case "active":
      return "active";
    case "waiting":
      return "waiting";
    case "project":
      return `project:${route.projectId}`;
    case "manage":
    case "analytics":
    case "view":
    case "task":
      return null;
  }
}

/** A resolved route that is a screen — `layoutKeyOf` answered a key for it. */
export type ScreenResolvedRoute = Extract<
  ResolvedTasksRoute,
  { kind: "all" | "active" | "waiting" | "project" }
>;

/** Narrows a resolved route to a screen, reusing `layoutKeyOf`'s classification rather than repeating the kind list. */
export function isScreenRoute(route: ResolvedTasksRoute): route is ScreenResolvedRoute {
  return layoutKeyOf(route) !== null;
}
