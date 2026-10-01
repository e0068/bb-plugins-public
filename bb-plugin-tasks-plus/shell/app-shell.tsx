import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBbNavigate, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import type { TaskLayout } from "../shared/enums.js";
import type { ViewTarget } from "../views/common/view-state.js";
import { useProjects, useSavedViews } from "../client/data.js";
import { applyListState } from "../views/common/view-state.js";
import type { NewTaskSeed } from "../views/common/new-task-seed.js";
import { NewTaskSeedContext } from "../views/common/new-task-seed-context.js";
import {
  PANEL_PATH,
  parseTasksRoute,
  useTasksNavigation,
  type ResolvedTasksRoute,
  type TasksNavigation,
  type TasksRoute,
} from "../client/routes.js";
import { loadLayout, loadStoredLayout, storeLayout } from "./view-preference.js";
import { TasksTopbar } from "./topbar.js";
import { isScreenRoute, layoutKeyOf, viewTargetOf } from "./view-target.js";
import { DisplayPanel } from "../views/common/display-panel.js";
import { TasksNavigationPanelContent } from "./navigation-panel.js";
import {
  ResizeHandle,
  useResizableWidth,
} from "@bb-plugins/resizable-pane/react";
import { useRememberedRoute } from "@bb-plugins/panel-state/react";
import { TableView } from "../views/table/index.js";
import { BoardView } from "../views/board/index.js";
import { applyBoardState, hasBoardDraft, scopeBoardKey } from "../views/board/board-preference.js";
import { DetailView } from "../views/detail/index.js";
import { AnalyticsDashboard } from "../views/analytics/AnalyticsDashboard.js";
import { ReducedColorsProvider } from "@bb-plugins/reduced-colors";
import { useTasksRpc } from "./data.js";
import {
  ManagePanel,
  NewProjectDialog,
  NewTaskDialog,
} from "../views/manage/index.js";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { visibleColumns } from "./columns.js";
import { TasksRefreshProvider } from "../client/refresh.js";
import { TakenRefusalProvider } from "../components/task-taken-dialog.js";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

/**
 * True while any overlay (dialog/lightbox, dropdown menu, select listbox) is
 * open; both quick-create and Esc-to-back must yield to overlays. Radix and
 * the attachments lightbox all render `role` overlays only while open.
 */
function hasOpenOverlay(): boolean {
  return (
    document.querySelector(
      '[role="dialog"], [role="menu"], [role="listbox"]',
    ) !== null
  );
}

function NoProjectsEmptyState({ onNewProject }: { onNewProject: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex size-10 items-center justify-center rounded-md bg-secondary text-muted-foreground">
        <Icon name="ListTodo" className="size-5" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">No projects yet</p>
        <p className="text-sm text-muted-foreground">
          Create a project to start tracking tasks and dispatching work to
          agents.
        </p>
      </div>
      <Button size="sm" onClick={onNewProject}>
        <Icon name="Plus" className="size-3.5" />
        New project
      </Button>
    </div>
  );
}

/**
 * A saved view's table or board. A view carries the whole state of the
 * scope it opens, so opening it writes that state into the scope it names
 * and then renders the scope — a view is a navigation entry, not a second
 * kind of table. A board view keeps a draft of its own, keyed by the view.
 */
function SavedViewOutlet({ savedViewId, target }: { savedViewId: string; target: ViewTarget | null }) {
  const navigation = useTasksNavigation();
  const { data } = useSavedViews();
  const view = target?.view ?? null;
  // The view's state is written BEFORE the table or board exists, so neither
  // draws a frame of the state it replaces — hence "applied" gating the
  // render rather than an effect running alongside it.
  const [appliedFor, setAppliedFor] = useState<string | null>(null);
  // Keyed by view *and* the layout it's applied onto: switching a view's own
  // Table/Board choice is a second, later apply of the same view, not a
  // no-op — each layout keeps its own filters, and only the one on screen is
  // read back. `useSavedViews` handing back a fresh array on every
  // views:changed (a rename here, a save in another window) must not
  // re-trigger this — hence keying on the pair, not on the `view` object.
  const applied = useRef<string | null>(null);

  useEffect(() => {
    if (!view || target === null) return;
    const key = `${savedViewId}:${target.layout}`;
    if (applied.current === key) return;
    applied.current = key;
    if (target.layout === "board") {
      // A board view keeps its own draft: opened again, it shows what the
      // owner left there until Reset — and never touches the scope's board.
      const boardKey = scopeBoardKey(target.scope, view.id);
      if (!hasBoardDraft(boardKey)) applyBoardState(boardKey, view);
    } else {
      applyListState(view);
    }
    setAppliedFor(key);
  }, [savedViewId, view, target]);

  if (data === undefined) return null;
  if (!view || target === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm font-medium">This view is gone</p>
        <p className="text-sm text-muted-foreground">
          It was deleted, here or in another window.
        </p>
        <Button size="sm" onClick={() => navigation.go({ kind: "all", view: null })}>
          All tasks
        </Button>
      </div>
    );
  }
  if (appliedFor !== `${savedViewId}:${target.layout}`) return null;
  return target.layout === "board" ? (
    <BoardView key={savedViewId} scope={target.scope} viewId={view.id} />
  ) : (
    <TableView key={savedViewId} scope={target.scope} />
  );
}

function RouteOutlet({ route, target }: { route: ResolvedTasksRoute; target: ViewTarget | null }) {
  switch (route.kind) {
    case "manage":
      return <ManagePanel />;
    case "analytics":
      return <AnalyticsScreen />;
    case "task":
      return <DetailView taskKey={route.taskKey} />;
    case "view":
      return <SavedViewOutlet savedViewId={route.savedViewId} target={target} />;
    case "all":
    case "active":
    case "waiting":
    case "project":
      // viewTargetOf hands back a target for exactly these kinds.
      return target === null ? null : target.layout === "board" ? (
        <BoardView scope={target.scope} />
      ) : (
        <TableView scope={target.scope} />
      );
  }
}

/**
 * A screen URL without a `?view=` marker (sidebar click, breadcrumb, deep
 * link) restores the layout this client last used for that screen.
 */
function resolveRoute(route: TasksRoute): ResolvedTasksRoute {
  switch (route.kind) {
    case "all":
    case "active":
    case "waiting":
    case "project":
      // layoutKeyOf always answers a key for these four kinds — see its doc.
      return { ...route, view: route.view ?? loadLayout(layoutKeyOf(route)!) };
    case "manage":
    case "analytics":
    case "view":
    case "task":
      return route;
  }
}

function TasksAppShellContent({ subPath }: PluginNavPanelProps) {
  const route = resolveRoute(parseTasksRoute(subPath));
  const tasksNavigation = useTasksNavigation();
  // Leaving the panel unmounts it and bb hands back an empty subPath on
  // return, which dropped the user back on "all tasks" from whatever project
  // or task they had open. The last route is remembered and reopened; a deep
  // link (a task URL, a ::task card) still wins, being an explicit address.
  useRememberedRoute(
    PANEL_PATH,
    subPath,
    // Restoring goes through the raw navigation, not the wrapper below: it's
    // putting back where the user was, not a fresh choice of view to store.
    useCallback(
      (next: string) =>
        tasksNavigation.go(parseTasksRoute(next), { replace: true }),
      [tasksNavigation],
    ),
  );
  // Every explicit layout in a navigation is a user choice worth remembering
  // — the Display panel's Table/Board switch is the only source of one.
  const navigation = useMemo<TasksNavigation>(
    () => ({
      go: (nextRoute, options) => {
        switch (nextRoute.kind) {
          case "all":
          case "active":
          case "waiting":
          case "project":
            // layoutKeyOf always answers a key for these four kinds.
            if (nextRoute.view !== null) storeLayout(layoutKeyOf(nextRoute)!, nextRoute.view);
            break;
          case "manage":
          case "analytics":
          case "view":
          case "task":
            break;
        }
        tasksNavigation.go(nextRoute, options);
      },
    }),
    [tasksNavigation],
  );
  // A saved view's own Table/Board choice: written under its "view:<id>" key
  // and redrawn in place — a view never navigates to change its layout.
  const [, forceViewLayoutRerender] = useState(0);
  const setViewLayout = useCallback((savedViewId: string, next: TaskLayout) => {
    storeLayout(`view:${savedViewId}`, next);
    forceViewLayoutRerender((tick) => tick + 1);
  }, []);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  // The open list's filters as a draft, so New task and "c" start from them.
  const [listSeed, setListSeed] = useState<NewTaskSeed | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  // Navigation is the panel's own left column. The page's right panel holds
  // the Task tab a click opens into (client/task-opening.ts).
  // Ширина решает, с чего панель открывается, и только это: дальше открыть или
  // закрыть навигацию — выбор владельца, и поворот экрана его не переигрывает.
  const compact = useIsCompactViewport();
  const [navOpen, setNavOpen] = useState(() => !compact);
  const columns = visibleColumns({ compact, navOpen });
  const { width: navWidth, startResize } = useResizableWidth({
    side: "left",
    initial: 280,
    min: 200,
    max: 520,
    storageKey: "tasks-plus:nav-pane-width",
  });

  const mainRef = useRef<HTMLElement>(null);
  const projects = useProjects();
  const savedViews = useSavedViews();
  // The table or board on screen: the header's controls and the Display panel
  // both act on it. Where there is none, the panel has nothing to set and closes.
  const target = viewTargetOf(route, savedViews.data, loadStoredLayout);
  const [displayOpen, setDisplayOpen] = useState(false);
  const hasTarget = target !== null;
  useEffect(() => {
    if (!hasTarget) setDisplayOpen(false);
  }, [hasTarget]);

  // Esc from a task returns to the list/board the user came from. null until
  // the user browses one this session (e.g. a deep-linked refresh).
  const lastBrowseRouteRef = useRef<TasksRoute | null>(null);
  useEffect(() => {
    if (route.kind !== "task") lastBrowseRouteRef.current = route;
    // Routes are plain data; keying on subPath tracks every route change.
  }, [subPath]);

  // A move made in navigation is a move *into* the area: on one column the
  // area has to come forward, or the tap looks as if nothing happened. It is
  // the move that closes navigation, not the width — turning the phone
  // sideways and back leaves open what the owner opened.
  const navRouteRef = useRef(subPath);
  useEffect(() => {
    if (navRouteRef.current === subPath) return;
    navRouteRef.current = subPath;
    if (compact) setNavOpen(false);
  }, [subPath, compact]);
  const backFromTask = () =>
    navigation.go(lastBrowseRouteRef.current ?? { kind: "all", view: null });
  const onTaskRoute = route.kind === "task";
  const backRef = useRef(backFromTask);
  backRef.current = backFromTask;
  useEffect(() => {
    if (!onTaskRoute) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (isEditableTarget(event.target)) return;
      // Overlays (lightbox > dialog > menu) consume Esc before task-back.
      if (hasOpenOverlay()) return;
      backRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onTaskRoute]);

  const noProjects = projects.data !== undefined && projects.data.length === 0;
  const newTaskProjectId = route.kind === "project" ? route.projectId : null;

  // Quick-create: bare "c" (no modifiers, no editable focus, no open overlay)
  // opens the New task dialog scoped to the current route's project.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "c" || event.metaKey || event.ctrlKey || event.altKey)
        return;
      if (event.defaultPrevented || event.repeat) return;
      if (isEditableTarget(event.target)) return;
      if (hasOpenOverlay()) return;
      event.preventDefault();
      setNewTaskOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="relative flex h-full min-h-0 bg-background text-foreground">
      {columns === "all" ? (
        <>
          <div
            style={{ width: navWidth }}
            className="h-full min-h-0 shrink-0 overflow-hidden"
          >
            <TasksNavigationPanelContent subPath={subPath} />
          </div>
          <ResizeHandle onPointerDown={startResize} />
        </>
      ) : null}
      <main ref={mainRef} className="@container flex min-w-0 flex-1 flex-col">
        <TasksTopbar
          route={route}
          projects={projects.data}
          pagerScope={
            lastBrowseRouteRef.current === null
              ? null
              : {
                  projectId:
                    lastBrowseRouteRef.current.kind === "project"
                      ? lastBrowseRouteRef.current.projectId
                      : null,
                }
          }
          onNavigate={navigation.go}
          onNewTask={() => setNewTaskOpen(true)}
          onBack={backFromTask}
          navOpen={navOpen}
          onToggleNav={() => setNavOpen((v) => !v)}
          target={target}
          displayOpen={displayOpen && hasTarget}
          onToggleDisplay={() => setDisplayOpen((open) => !open)}
        />
        <div className="relative flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">
          {/* Узкий экран: навигация занимает то же место, что область, — топбар
              с кнопкой остаётся над ней, и он же уводит навигацию обратно. */}
          {columns === "navigation" ? (
            <TasksNavigationPanelContent subPath={subPath} />
          ) : noProjects && route.kind !== "task" && route.kind !== "manage" ? (
            <NoProjectsEmptyState
              onNewProject={() => setNewProjectOpen(true)}
            />
          ) : (
            <NewTaskSeedContext.Provider value={setListSeed}>
              <RouteOutlet route={route} target={target} />
            </NewTaskSeedContext.Provider>
          )}
        </div>
        {displayOpen && target !== null ? (
          // Beside the tasks on a wide panel; over them, full width, on a narrow one.
          <div className="w-[300px] shrink-0 border-l border-border-hairline max-md:absolute max-md:inset-0 max-md:z-30 max-md:w-full max-md:border-l-0">
            <DisplayPanel
              target={target}
              layout={
                isScreenRoute(route)
                  ? { value: route.view, onChange: (view) => navigation.go({ ...route, view }) }
                  : route.kind === "view"
                    ? { value: target.layout, onChange: (view) => setViewLayout(route.savedViewId, view) }
                    : undefined
              }
              onClose={() => setDisplayOpen(false)}
            />
          </div>
        ) : null}
        </div>
      </main>
      <NewTaskDialog
        open={newTaskOpen}
        onOpenChange={setNewTaskOpen}
        projectId={newTaskProjectId}
        seed={listSeed ?? undefined}
      />
      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
      />
    </div>
  );
}

export function TasksAppShell(props: PluginNavPanelProps) {
  const navigate = useBbNavigate();
  // The refusal dialog sits above every screen of the panel; its way into a
  // thread is bb's navigation, handed down because components/ knows no router.
  return (
    <TasksRefreshProvider>
      <TakenRefusalProvider onOpenThread={(threadId) => navigate.toThread(threadId)}>
        <TasksAppShellContent {...props} />
      </TakenRefusalProvider>
    </TasksRefreshProvider>
  );
}

/** The analytics screen under its Reduced Colors, loaded once per visit (packages/reduced-colors). */
function AnalyticsScreen() {
  const rpc = useTasksRpc();
  return (
    <ReducedColorsProvider load={() => rpc.call("loadReducedColors", {})}>
      <AnalyticsDashboard />
    </ReducedColorsProvider>
  );
}
