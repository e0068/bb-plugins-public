import { useCallback, useMemo } from "react";
import type { Project, SavedView, Task } from "../shared/contract.js";
import { groupTasksByStatus, nestSubtasks } from "../views/common/lib.js";
import { listAllTasks, useTasksQuery } from "../client/data.js";
import type { ResolvedTasksRoute, TasksRoute } from "../client/routes.js";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ViewToolbar } from "../views/board/toolbar.js";
import type { ViewTarget } from "../views/common/view-state.js";
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
import { useTasksRefresh } from "../client/refresh.js";

/** Accessible name + tooltip for the header refresh control. */
export const REFRESH_TASKS_LABEL = "Refresh tasks";

export interface PagerPosition {
  /** 1-based position of the task within its sibling list. */
  index: number;
  total: number;
  prevKey: string | null;
  nextKey: string | null;
}

/**
 * Position of `taskKey` within its sibling tasks, mirroring the list view's
 * visual order: canonical status groups, board position within each group
 * (the order `listTasks` returns). Sub-tasks aren't list rows, so a sub-task
 * (or unknown key) has no pager position.
 */
export function pagerPosition(
  tasks: readonly Task[],
  taskKey: string,
): PagerPosition | null {
  const ordered = groupTasksByStatus(nestSubtasks(tasks))
    .flatMap((group) => group.entries)
    .filter((entry) => entry.depth === 0)
    .map((entry) => entry.task);
  const wanted = taskKey.toUpperCase();
  const index = ordered.findIndex((task) => task.key.toUpperCase() === wanted);
  if (index === -1) return null;
  return {
    index: index + 1,
    total: ordered.length,
    prevKey: ordered[index - 1]?.key ?? null,
    nextKey: ordered[index + 1]?.key ?? null,
  };
}

function TaskPager({
  taskKey,
  projectId,
  onNavigate,
}: {
  taskKey: string;
  /** Scope from the list/board the user came from; null = All tasks. */
  projectId: string | null;
  onNavigate: (route: TasksRoute) => void;
}) {
  // Same query the list view issues (unfiltered): top-level tasks in the
  // browse scope. The pager ignores the list's transient filter state — it
  // steps through the full sibling list.
  const siblings = useTasksQuery(
    async (rpc) =>
      listAllTasks(rpc, {
        ...(projectId === null ? {} : { projectId }),
        parentTaskId: null,
      }),
    ["tasks:changed"],
    [projectId],
  );
  const position = useMemo(
    () => (siblings.data ? pagerPosition(siblings.data, taskKey) : null),
    [siblings.data, taskKey],
  );
  if (!position) return null;
  const step = (key: string | null) => {
    if (key !== null) onNavigate({ kind: "task", taskKey: key });
  };
  return (
    // The pager yields entirely below @sm so the task key — the row's
    // identity — keeps the width; the in-page task content carries its own
    // navigation on the smallest phones.
    <div className="hidden shrink-0 items-center gap-0.5 text-xs tabular-nums text-muted-foreground @sm:flex">
      {/* The position readout yields to the task key in narrow containers;
          the step buttons remain. */}
      <span className="hidden px-1 @md:inline">
        {position.index} / {position.total}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 max-md:pointer-coarse:size-9"
        aria-label="Previous task"
        disabled={position.prevKey === null}
        onClick={() => step(position.prevKey)}
      >
        <Icon name="ChevronUp" className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 max-md:pointer-coarse:size-9"
        aria-label="Next task"
        disabled={position.nextKey === null}
        onClick={() => step(position.nextKey)}
      >
        <Icon name="ChevronDown" className="size-3.5" />
      </Button>
    </div>
  );
}

/**
 * Subtle icon-only refresh control. Shares the BB-19 generation channel; does
 * not add listeners or alternate refresh paths. In-flight state tracks real
 * generation-driven query work (spin + disabled) with fixed geometry so the
 * header does not shift.
 *
 * A click re-queries every task file fresh (the generation bump) — there is
 * no separate sync step to kick, since tasks are read straight off disk on
 * every request (see decisions/tasks-files-are-the-store.md).
 */
function RefreshTasksButton() {
  const { refresh, isRefreshing } = useTasksRefresh();

  const handleRefresh = useCallback(() => {
    if (isRefreshing) return;
    refresh();
  }, [isRefreshing, refresh]);

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground active:bg-state-active active:text-foreground max-md:pointer-coarse:size-9"
            aria-label={REFRESH_TASKS_LABEL}
            aria-busy={isRefreshing}
            disabled={isRefreshing}
            onClick={handleRefresh}
          >
            <Icon
              name="RotateCcw"
              className={cn("size-3.5", isRefreshing && "animate-spin")}
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{REFRESH_TASKS_LABEL}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export interface TasksTopbarProps {
  route: ResolvedTasksRoute;
  projects: Project[] | undefined;
  /**
   * Pager scope on task routes: the list/board browsed before (projectId null
   * = All tasks). null when no list/board was visited this session (deep
   * link) — the pager then anchors to the task's own project.
   */
  pagerScope: { projectId: string | null } | null;
  onNavigate: (route: TasksRoute) => void;
  onNewTask: () => void;
  /** The list or board this row controls; null on a task, Manage or Analytics. */
  target: ViewTarget | null;
  /** Whether the Display panel is open beside the tasks. */
  displayOpen: boolean;
  onToggleDisplay: () => void;
  onBack: () => void;
  /**
   * Whether the left navigation column is open. The toggle button only
   * renders when onToggleNav is passed, so the prop is backward-compatible.
   */
  navOpen?: boolean;
  onToggleNav?: () => void;
}

export function TasksTopbar({
  route,
  projects,
  pagerScope,
  onNavigate,
  onNewTask,
  onBack,
  navOpen,
  onToggleNav,
  target,
  displayOpen,
  onToggleDisplay,
}: TasksTopbarProps) {
  // The open view comes with the target: one lookup for the header and the panel.
  const openView: SavedView | null = route.kind === "view" ? (target?.view ?? null) : null;
  const compact = useIsCompactViewport();
  const project = useMemo(() => {
    if (route.kind === "view") {
      return (projects ?? []).find((p) => p.id === openView?.projectId) ?? null;
    }
    if (route.kind === "project") {
      return (projects ?? []).find((p) => p.id === route.projectId) ?? null;
    }
    if (route.kind === "task") {
      // Task keys are `<prefix>-<number>`, so the prefix resolves the project.
      const prefix = route.taskKey.split("-", 1)[0] ?? "";
      return (projects ?? []).find((p) => p.prefix === prefix) ?? null;
    }
    return null;
  }, [route, projects, openView?.projectId]);

  const breadcrumb = (() => {
    switch (route.kind) {
      case "all":
        return (
          <span className="whitespace-nowrap font-semibold">All tasks</span>
        );
      case "active":
        return (
          <span className="flex items-center gap-2">
            <span className="whitespace-nowrap font-semibold">Active</span>
            <span className="hidden text-xs font-normal text-muted-foreground @md:inline">
              agents working now
            </span>
          </span>
        );
      case "manage":
        return (
          <span className="flex items-center gap-2">
            <span className="whitespace-nowrap font-semibold">Manage</span>
            <span className="hidden text-xs font-normal text-muted-foreground @md:inline">
              labels, presets, folders
            </span>
          </span>
        );
      case "project":
        return (
          <span className="flex min-w-0 items-center gap-2">
            {project ? (
              <span
                aria-hidden
                className="size-3 shrink-0 rounded-sm"
                style={{ backgroundColor: project.color }}
              />
            ) : null}
            <span className="truncate font-semibold">
              {project?.name ?? "Project"}
            </span>
          </span>
        );
      case "view":
        return (
          <span className="flex min-w-0 items-center gap-2">
            {/* A board view names its project; a list view is its own place. */}
            {project && target?.layout === "board" ? (
              <>
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: project.color }}
                />
                <span className="hidden truncate text-muted-foreground @md:inline">{project.name}</span>
                <span className="hidden text-subtle-foreground @md:inline">/</span>
              </>
            ) : null}
            <span className="truncate font-semibold">{openView?.name ?? "View"}</span>
          </span>
        );
      case "task":
        return (
          <span className="flex min-w-0 items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 max-md:pointer-coarse:size-9"
              aria-label="Back (Esc)"
              onClick={onBack}
            >
              <Icon name="ChevronLeft" className="size-4" />
            </Button>
            {/* In narrow containers the project crumb yields the row to the
                task key — the back button already returns to the project. */}
            {project ? (
              <button
                type="button"
                className="hidden min-w-0 items-center gap-2 text-muted-foreground hover:text-foreground @md:flex"
                onClick={() =>
                  // No explicit view: the shell restores the project's
                  // remembered List/Board choice.
                  onNavigate({
                    kind: "project",
                    projectId: project.id,
                    view: null,
                  })
                }
              >
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-sm"
                  style={{ backgroundColor: project.color }}
                />
                <span className="truncate font-medium">{project.name}</span>
              </button>
            ) : null}
            {project ? (
              <Icon
                name="ChevronRight"
                className="hidden size-3 shrink-0 text-muted-foreground @md:block"
              />
            ) : null}
            <span className="min-w-0 truncate font-medium text-muted-foreground">
              {route.taskKey}
            </span>
          </span>
        );
    }
  })();

  return (
    // The host renders its pane header (with the sidebar toggle) above this bar
    // on every viewport, so the bar needs no left reserve for that toggle.
    <header className="flex h-11 shrink-0 items-center gap-2.5 border-b border-border-hairline bg-background px-3.5 text-sm max-md:h-12">
      {onToggleNav ? (
        <Button
          variant="ghost"
          size="icon"
          className="-ml-1 size-7 shrink-0"
          aria-label={navOpen ? "Hide navigation" : "Show navigation"}
          aria-pressed={navOpen ?? false}
          onClick={onToggleNav}
        >
          <Icon name="Menu" className="size-4" />
        </Button>
      ) : null}
      {/* With view controls the free width goes to the filter chips, and the
          title keeps only what it needs. */}
      <div className={cn("min-w-0 overflow-hidden", target ? "shrink" : "flex-1")}>{breadcrumb}</div>
      {target ? (
        <ViewToolbar target={target} compact={compact} displayOpen={displayOpen} onToggleDisplay={onToggleDisplay} />
      ) : null}
      {route.kind === "task" &&
      (pagerScope !== null || projects !== undefined) ? (
        <TaskPager
          taskKey={route.taskKey}
          // No browse context (deep link): step through the task's own
          // project in list order; All tasks only if its project is unknown.
          projectId={
            pagerScope !== null ? pagerScope.projectId : (project?.id ?? null)
          }
          onNavigate={onNavigate}
        />
      ) : null}
      {/* Refresh sits immediately left of the primary New task action. */}
      <RefreshTasksButton />
      {route.kind !== "task" && route.kind !== "manage" ? (
        <Button
          size="sm"
          className="h-7 gap-1.5 max-md:pointer-coarse:h-9"
          aria-label="New task"
          onClick={onNewTask}
        >
          <Icon name="Plus" className="size-3.5" />
          {/* Icon-only in narrow containers so the breadcrumb (project name,
              view toggle) keeps readable width. */}
          <span className="hidden @lg:inline">New task</span>
        </Button>
      ) : null}
    </header>
  );
}
