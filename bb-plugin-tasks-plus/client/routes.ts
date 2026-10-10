import { useMemo } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { TaskLayout } from "../shared/enums.js";

/** The nav panel `path` registered in app.tsx; panel URLs are /plugins/tasks/<PANEL_PATH>/<subPath>. */
export const PANEL_PATH = "tasks";

/** Kept for importers: the address grammar's layout is `TaskLayout`. */
export type TaskViewMode = TaskLayout;

/**
 * A route's `view` is `null` when the URL names no layout — the shell then
 * resolves the user's stored preference for that screen (see
 * view-preference.ts). Navigating with an explicit view pins it in the URL.
 */
export type TasksRoute =
  /** `thread` narrows every task to the ones that thread is attached to. */
  | { kind: "all"; view: TaskLayout | null; thread?: string }
  | { kind: "active"; view: TaskLayout | null }
  | { kind: "waiting"; view: TaskLayout | null }
  | { kind: "manage" }
  | { kind: "analytics" }
  /** A saved view: the list it names, with its filters, sort and columns. */
  | { kind: "view"; savedViewId: string }
  | { kind: "project"; projectId: string; view: TaskLayout | null }
  | { kind: "task"; taskKey: string };

/** A route whose layout has been resolved; what the shell renders. */
export type ResolvedTasksRoute =
  | Exclude<TasksRoute, { kind: "all" | "active" | "waiting" | "project" }>
  | { kind: "all"; view: TaskLayout; thread?: string }
  | { kind: "active"; view: TaskLayout }
  | { kind: "waiting"; view: TaskLayout }
  | { kind: "project"; projectId: string; view: TaskLayout };

/**
 * subPath grammar (the trailing route below /plugins/tasks/tasks):
 *   ""                      → all tasks (default)
 *   "all"                   → all tasks
 *   "all?thread=<threadId>" → all tasks that thread is attached to
 *   "active"                → tasks with agents working
 *   "waiting"               → tasks with an idle, non-archived thread
 *   "manage"                → manage panel (labels, presets, folders)
 *   "analytics"             → analytics dashboard (BBPL-259)
 *   "task/<taskKey>"        → task detail (e.g. task/TSK-4)
 *   "<projectId>"           → project, view from the stored preference
 *   "?view=list" / "?view=table" / "?view=board" → pins a layout; "list" reads as "table"
 */
function parseView(query: string): TaskLayout | null {
  const raw = new URLSearchParams(query).get("view");
  if (raw === "list") return "table";
  return raw === "table" || raw === "board" ? raw : null;
}

function withView(base: string, view: TaskLayout | null): string {
  return view === null ? base : `${base}?view=${view}`;
}

/** The all-tasks route, narrowed to a thread when the address names one. */
function allRoute(query: string): TasksRoute {
  const thread = new URLSearchParams(query).get("thread");
  return thread === null ? { kind: "all", view: parseView(query) } : { kind: "all", view: parseView(query), thread };
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseTasksRoute(rawSubPath: string): TasksRoute {
  // The host hands the splat through URL-encoded; the `?view=` marker inside
  // a segment arrives as %3F.
  const subPath = rawSubPath.split("/").map(decodeSegment).join("/");
  const queryIndex = subPath.indexOf("?");
  const path = queryIndex === -1 ? subPath : subPath.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : subPath.slice(queryIndex + 1);
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const head = segments[0];
  if (head === undefined || head === "all") return allRoute(query);
  if (head === "active") return { kind: "active", view: parseView(query) };
  if (head === "waiting") return { kind: "waiting", view: parseView(query) };
  if (head === "manage") return { kind: "manage" };
  if (head === "analytics") return { kind: "analytics" };
  if (head === "task") {
    const taskKey = segments[1];
    if (taskKey !== undefined) return { kind: "task", taskKey };
    return { kind: "all", view: null };
  }
  if (head === "view") {
    const savedViewId = segments[1];
    if (savedViewId !== undefined) return { kind: "view", savedViewId };
    return { kind: "all", view: null };
  }
  return {
    kind: "project",
    projectId: head,
    // Anything other than a known layout (including no marker at all)
    // leaves the choice to the caller's stored preference.
    view: parseView(query),
  };
}

export function tasksRouteToSubPath(route: TasksRoute): string {
  switch (route.kind) {
    case "all": {
      const base = withView("all", route.view);
      return route.thread === undefined ? base : `${base}${route.view === null ? "?" : "&"}thread=${route.thread}`;
    }
    case "active":
      return withView("active", route.view);
    case "waiting":
      return withView("waiting", route.view);
    case "manage":
      return "manage";
    case "analytics":
      return "analytics";
    case "task":
      return `task/${route.taskKey}`;
    case "view":
      return `view/${route.savedViewId}`;
    case "project":
      return withView(route.projectId, route.view);
  }
}

/**
 * Where Tasks+ opens for a thread: its only task, or every task narrowed to
 * it when it has several; null — no task, the page stays where it is.
 */
export function threadTasksRoute(threadId: string, tasks: readonly { readonly key: string }[]): TasksRoute | null {
  const [only, ...rest] = tasks;
  if (only === undefined) return null;
  return rest.length === 0 ? { kind: "task", taskKey: only.key } : { kind: "all", view: null, thread: threadId };
}

/**
 * The address the panel remembers for its next visit: all tasks of a thread
 * is remembered as all tasks — the narrowing belongs to the thread the owner
 * came from this time, not to the next visit.
 */
export function rememberedSubPath(subPath: string): string {
  const route = parseTasksRoute(subPath);
  return route.kind === "all" && route.thread !== undefined
    ? tasksRouteToSubPath({ kind: "all", view: route.view })
    : subPath;
}

export interface TasksNavigation {
  go: (route: TasksRoute, options?: { replace?: boolean }) => void;
}

export function useTasksNavigation(): TasksNavigation {
  const navigate = useBbNavigate();
  return useMemo(
    () => ({
      go: (route, options) => {
        navigate.toPluginPanel(PANEL_PATH, {
          subPath: tasksRouteToSubPath(route),
          ...(options?.replace ? { replace: true } : {}),
        });
      },
    }),
    [navigate],
  );
}
