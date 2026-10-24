import { createContext, useCallback, useContext, useEffect, useMemo, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import type {
  Folder,
  Preset,
  Project,
  SavedView,
  SidebarProjectSummary,
  Task,
} from "../shared/contract.js";
import { useSavedViews, useTasksRpc } from "../client/data.js";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { FoldersRpcContract } from "../folders/contract.js";
import { Input } from "@/components/ui/input";
import type { TasksRoute } from "../client/routes.js";
import {
  PresetDialog,
  savePresetDraft,
} from "../views/manage/preset-dialog.js";
import { Icon } from "@/components/ui/icon";
import { DelayedLoading } from "../components/delayed-loading.js";
import { DEFAULT_PROJECT_ICON } from "@bb-plugins/icon-catalog";
import { EntityIcon } from "../components/entity-icon.js";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "../components/confirm-dialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Segments } from "@/components/ui/segments";
import {
  closedAtDepth,
  foldedLevel,
  isSection as isTable,
  foldLevels,
  sectionsIn,
  sectionsUnder,
  sectionTree,
  takesSection,
  toggleOpen,
  treeKey,
  treeRows,
  useClosedSections,
  type SectionNode,
} from "./section-tree.js";

interface SidebarRowProps {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  title?: string;
  /** A row of the project tree: the arrows walk to it by this id. */
  rowId?: string;
}

function ViewRow({
  view,
  active,
  onOpen,
  onRename,
  onDelete,
}: {
  view: SavedView;
  active: boolean;
  onOpen: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [mode, setMode] = useState<"row" | "rename" | "confirm">("row");
  const [draft, setDraft] = useState(view.name);

  if (mode === "rename") {
    return (
      <div className="px-2 py-1">
        <Input
          autoFocus
          aria-label="View name"
          className="h-7 text-sm"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && draft.trim() !== "") {
              onRename(draft.trim());
              setMode("row");
            }
            if (event.key === "Escape") {
              setDraft(view.name);
              setMode("row");
            }
          }}
        />
      </div>
    );
  }

  if (mode === "confirm") {
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-sm">
        <span className="flex-1 truncate text-muted-foreground">Delete?</span>
        <button
          type="button"
          aria-label={`Keep "${view.name}"`}
          className="rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-state-hover"
          onClick={() => setMode("row")}
        >
          Cancel
        </button>
        <button
          type="button"
          aria-label={`Confirm deleting "${view.name}"`}
          className="rounded-sm bg-secondary px-1.5 py-0.5 text-xs text-foreground hover:bg-state-hover"
          onClick={() => {
            onDelete();
            setMode("row");
          }}
        >
          Delete
        </button>
      </div>
    );
  }

  return (
    <div className="group/view relative">
      <SidebarRow active={active} onClick={onOpen}>
        <Icon name="ListView" className="size-3.5 shrink-0" />
        <span className="flex-1 truncate">{view.name}</span>
      </SidebarRow>
      <span className="absolute right-1 top-0 hidden h-7 items-center gap-0.5 group-hover/view:flex">
        <button
          type="button"
          aria-label={`Rename "${view.name}"`}
          className="rounded-sm p-1 text-muted-foreground hover:bg-state-hover hover:text-foreground"
          onClick={() => {
            setDraft(view.name);
            setMode("rename");
          }}
        >
          <Icon name="Edit" className="size-3" />
        </button>
        <button
          type="button"
          aria-label={`Delete "${view.name}"`}
          className="rounded-sm p-1 text-muted-foreground hover:bg-state-hover hover:text-foreground"
          onClick={() => setMode("confirm")}
        >
          <Icon name="Trash2" className="size-3" />
        </button>
      </span>
    </div>
  );
}

function SidebarRow({ active, onClick, children, title, rowId }: SidebarRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      data-tree-row={rowId}
      className={cn(
        "flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:pointer-coarse:h-9",
        onClick ? "cursor-pointer" : "cursor-default",
        active
          ? "bg-sidebar-accent font-medium text-foreground"
          : "text-muted-foreground",
        onClick && !active && "hover:bg-state-hover hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function SectionHeader({
  label,
  collapsed,
  onToggle,
  trailing,
}: {
  label: string;
  collapsed?: boolean;
  onToggle?: () => void;
  /** Drawn at the header's end — the project tree's level switch. */
  trailing?: ReactNode;
}) {
  const content = (
    <>
      {onToggle ? (
        <Icon
          name="ChevronDown"
          className={cn(
            "size-3 transition-transform",
            collapsed && "-rotate-90",
          )}
        />
      ) : null}
      {label}
    </>
  );
  if (onToggle) {
    return (
      <div className="mt-3.5 flex items-center gap-1 pr-2">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-2 pb-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
          aria-expanded={!collapsed}
        >
          {content}
        </button>
        {trailing}
      </div>
    );
  }
  return (
    <div className="mt-3.5 flex items-center gap-1 px-2 pb-1 text-xs font-semibold text-muted-foreground">
      {content}
      {trailing}
    </div>
  );
}

function WorkingDot() {
  return (
    <span
      aria-hidden
      className="size-1.5 shrink-0 animate-pulse rounded-full bg-success"
    />
  );
}

function RowCount({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("ml-auto text-xs tabular-nums text-muted-foreground", className)}>
      {value}
    </span>
  );
}

function ProjectRow({
  project,
  summary,
  active,
  onClick,
  countGivesWay = false,
  branch = false,
}: {
  project: Project;
  summary: SidebarProjectSummary | undefined;
  active: boolean;
  onClick: () => void;
  /** The row has a "+" at its end: the count steps out of its way while the row is hovered or focused. */
  countGivesWay?: boolean;
  /** The row holds sections: its icon gives way to the chevron that folds them while the row is hovered. */
  branch?: boolean;
}) {
  return (
    <SidebarRow active={active} onClick={onClick} title={project.name} rowId={project.id}>
      <EntityIcon
        icon={project.icon}
        color={project.color}
        fallback={DEFAULT_PROJECT_ICON}
        className={cn("size-3.5 shrink-0", branch && "group-hover/project:invisible group-focus-within/project:invisible")}
      />
      <span className="min-w-0 flex-1 truncate">{project.name}</span>
      {summary && summary.activeAgentCount > 0 ? <WorkingDot /> : null}
      {summary ? (
        <RowCount
          value={summary.taskCount}
          className={countGivesWay ? "group-hover/project:invisible group-focus-within/project:invisible" : undefined}
        />
      ) : null}
    </SidebarRow>
  );
}

/** The section being dragged over the tree and the row it would go into, shared by every row of the tree. */
interface SectionDrag {
  readonly dragged: Project | null;
  readonly over: string | null;
  readonly start: (section: Project) => void;
  readonly hover: (rowId: string | null) => void;
  readonly end: () => void;
}

const SectionDragContext = createContext<SectionDrag>({ dragged: null, over: null, start: () => {}, hover: () => {}, end: () => {} });

function useSectionDragState(): SectionDrag {
  const [dragged, setDragged] = useState<Project | null>(null);
  const [over, setOver] = useState<string | null>(null);
  return useMemo(
    () => ({
      dragged,
      over,
      start: setDragged,
      hover: setOver,
      end: () => {
        setDragged(null);
        setOver(null);
      },
    }),
    [dragged, over],
  );
}

/** A section of a project's database, shown under the project or under the section it sits in. */

/** The name field New section opens under its row: Enter makes the section and keeps the field busy until
 *  the section is on the list, Escape closes it. */
function NewSectionField({
  holder,
  projects,
  onCreated,
  onClose,
}: {
  holder: Project;
  projects: readonly Project[];
  onCreated: (boardId: string) => void;
  onClose: () => void;
}) {
  const folders = useRpc<FoldersRpcContract>();
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  // A second Enter while the first is on its way would make the section twice.
  const [pending, setPending] = useState(false);
  const [made, setMade] = useState<string | null>(null);
  useEffect(() => {
    if (made !== null && projects.some((project) => project.id === made)) onCreated(made);
  }, [made, projects, onCreated]);
  const busy = pending || made !== null;
  const create = async () => {
    setPending(true);
    setProblem(null);
    const result = await folders.call("createTable", { boardId: holder.id, name: draft.trim() }).finally(() => setPending(false));
    if (result.ok) setMade(result.boardId);
    else setProblem(result.message);
  };
  return (
    <div className="py-1 pl-6 pr-2">
      <div className="relative">
        <Input
          autoFocus
          aria-label="Section name"
          placeholder="Section name"
          className="h-7 pr-7 text-sm"
          value={draft}
          // Read-only, not disabled: a disabled field loses focus, and Escape would no longer close it.
          readOnly={busy}
          aria-busy={busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && draft.trim() !== "" && !busy) void create();
            if (event.key === "Escape") onClose();
          }}
        />
        {busy ? (
          <span role="status" aria-label="Creating the section" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
            <Icon name="Loading" className="size-3.5 animate-spin" />
          </span>
        ) : null}
      </div>
      {problem === null ? null : <p className="px-1 pt-1 text-xs text-destructive">{problem}</p>}
    </div>
  );
}

/** A project row or a section row, the sections inside it right under it — folded away while its branch is
 *  closed — each level a step further in, and New section on every row kept in a database. A section, not a
 *  project, can be renamed and deleted from its "⋯" menu. */
function ProjectEntry({
  project,
  projects,
  summaryByProject,
  activeProjectId,
  onOpen,
  closed,
  onToggle,
  holderId = null,
  depth = 0,
}: {
  project: Project;
  projects: readonly Project[];
  summaryByProject: ReadonlyMap<string, SidebarProjectSummary>;
  activeProjectId: string | null;
  onOpen: (projectId: string) => void;
  closed: ReadonlySet<string>;
  onToggle: (projectId: string) => void;
  /** The project or section this row sits in; none for a project. */
  holderId?: string | null;
  depth?: number;
}) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const holdsSections = project.database != null;
  const section = holderId !== null;
  const folders = useRpc<FoldersRpcContract>();
  const drag = useContext(SectionDragContext);
  const takes = drag.dragged !== null && takesSection(project, drag.dragged, projects);
  const dropHere = async (event: DragEvent) => {
    event.preventDefault();
    const moving = drag.dragged;
    drag.end();
    if (moving === null) return;
    setRefusal(null);
    const result = await folders
      .call("moveSection", { boardId: moving.id, into: project.id })
      .catch((error: unknown) => ({ ok: false as const, message: error instanceof Error ? error.message : String(error) }));
    if (!result.ok) setRefusal(result.message);
  };
  const sections = sectionsIn(project, projects);
  const branch = sections.length > 0;
  const open = branch && !closed.has(project.id);
  const created = useCallback(
    (boardId: string) => {
      setAdding(false);
      onOpen(boardId);
    },
    [onOpen],
  );
  return (
    <div data-depth={depth}>
      {renaming ? (
        <RenameSectionField section={project} onClose={() => setRenaming(false)} />
      ) : (
        <div
          className="group/project relative rounded-md data-[drop-target]:bg-sidebar-accent data-[drop-target]:ring-1 data-[drop-target]:ring-ring"
          data-drop-target={takes && drag.over === project.id ? "" : undefined}
          // A section is dragged by its row onto another row of its project, which it then sits in.
          draggable={section}
          onDragStart={
            section
              ? (event) => {
                  event.dataTransfer.setData("text/plain", project.name);
                  event.dataTransfer.effectAllowed = "move";
                  drag.start(project);
                }
              : undefined
          }
          onDragEnd={drag.end}
          onDragOver={
            takes
              ? (event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (drag.over !== project.id) drag.hover(project.id);
                }
              : undefined
          }
          onDragLeave={(event) => {
            if (drag.over === project.id && !event.currentTarget.contains(event.relatedTarget as Node | null)) drag.hover(null);
          }}
          onDrop={takes ? (event) => void dropHere(event) : undefined}
        >
          <ProjectRow
            project={project}
            summary={summaryByProject.get(project.id)}
            active={activeProjectId === project.id}
            onClick={() => onOpen(project.id)}
            countGivesWay={holdsSections}
            branch={branch}
          />
          {branch ? (
            <button
              type="button"
              aria-label={`${open ? "Collapse" : "Expand"} ${project.name}`}
              aria-expanded={open}
              className="absolute left-1 top-0 hidden h-7 w-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:flex group-hover/project:flex group-focus-within/project:flex max-md:pointer-coarse:h-9"
              onClick={() => onToggle(project.id)}
            >
              <Icon name="ChevronDown" className={cn("size-3 transition-transform", !open && "-rotate-90")} />
            </button>
          ) : null}
          {holdsSections ? (
            // Kept drawn while its menu is open: the menu is placed by the "⋯" it opened from, which a hidden row would leave at zero.
            <span className="absolute right-1 top-0 hidden h-7 items-center gap-0.5 focus-within:flex group-hover/project:flex has-[[data-state=open]]:flex max-md:pointer-coarse:h-9">
              {section ? (
                <SectionMenu
                  section={project}
                  onRename={() => setRenaming(true)}
                  onAdd={() => setAdding(true)}
                  onDelete={() => {
                    setRefusal(null);
                    setDeleting(true);
                  }}
                />
              ) : null}
              <button
                type="button"
                aria-label={`New section in ${project.name}`}
                className="flex h-7 items-center rounded-sm px-1 text-muted-foreground hover:bg-state-hover hover:text-foreground max-md:pointer-coarse:h-9"
                onClick={() => setAdding(true)}
              >
                <Icon name="Plus" className="size-3" />
              </button>
            </span>
          ) : null}
        </div>
      )}
      {open
        ? sections.map((inner) => (
            <div key={inner.id} className="pl-4">
              <ProjectEntry
                project={inner}
                projects={projects}
                summaryByProject={summaryByProject}
                activeProjectId={activeProjectId}
                onOpen={onOpen}
                closed={closed}
                onToggle={onToggle}
                holderId={project.id}
                depth={depth + 1}
              />
            </div>
          ))
        : null}
      {adding ? <NewSectionField holder={project} projects={projects} onClose={() => setAdding(false)} onCreated={created} /> : null}
      {deleting && holderId !== null ? (
        <DeleteSectionDialog
          section={project}
          projects={projects}
          summaryByProject={summaryByProject}
          onClose={() => setDeleting(false)}
          onDeleted={(gone) => {
            if (activeProjectId !== null && gone.has(activeProjectId)) onOpen(holderId);
          }}
          onFailed={setRefusal}
        />
      ) : null}
      {refusal === null ? null : (
        <p role="alert" className="flex items-start gap-1 px-2 pb-1 text-xs text-destructive">
          <span className="min-w-0 flex-1">{refusal}</span>
          <button type="button" aria-label="Dismiss" className="shrink-0" onClick={() => setRefusal(null)}>
            <Icon name="X" className="size-3" />
          </button>
        </p>
      )}
    </div>
  );
}

/** The "⋯" of a section row: rename it, add a section inside, delete it. */
function SectionMenu({ section, onRename, onAdd, onDelete }: { section: Project; onRename: () => void; onAdd: () => void; onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${section.name}`}
          className="flex h-7 items-center rounded-sm px-1 text-muted-foreground hover:bg-state-hover hover:text-foreground max-md:pointer-coarse:h-9"
        >
          <Icon name="MoreHorizontal" className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" collisionPadding={8}>
        <DropdownMenuItem onSelect={onRename}>
          <Icon name="Edit" className="size-3.5" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onAdd}>
          <Icon name="Plus" className="size-3.5" />
          New section inside
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive">
          <Icon name="Trash2" className="size-3.5" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The name field Rename puts in place of a section's row: Enter renames it for everyone on its database,
 *  Escape keeps the old name. */
function RenameSectionField({ section, onClose }: { section: Project; onClose: () => void }) {
  const folders = useRpc<FoldersRpcContract>();
  const [draft, setDraft] = useState(section.name);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rename = async () => {
    const name = draft.trim();
    if (name === section.name) return onClose();
    setBusy(true);
    setProblem(null);
    const result = await folders
      .call("renameSection", { boardId: section.id, name })
      .catch((error: unknown) => ({ ok: false as const, message: error instanceof Error ? error.message : String(error) }))
      .finally(() => setBusy(false));
    if (result.ok) onClose();
    else setProblem(result.message);
  };
  return (
    <div className="py-0.5 pr-2">
      <Input
        autoFocus
        aria-label="Section name"
        className="h-7 text-sm"
        value={draft}
        readOnly={busy}
        aria-busy={busy}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (!busy && problem === null) onClose();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && draft.trim() !== "" && !busy) void rename();
          if (event.key === "Escape") onClose();
        }}
      />
      {problem === null ? null : <p className="px-1 pt-1 text-xs text-destructive">{problem}</p>}
    </div>
  );
}

/** Asks before a section goes, naming what goes with it, and deletes it for everyone on its database. */
function DeleteSectionDialog({
  section,
  projects,
  summaryByProject,
  onClose,
  onDeleted,
  onFailed,
}: {
  section: Project;
  projects: readonly Project[];
  summaryByProject: ReadonlyMap<string, SidebarProjectSummary>;
  onClose: () => void;
  onDeleted: (gone: ReadonlySet<string>) => void;
  onFailed: (message: string) => void;
}) {
  const folders = useRpc<FoldersRpcContract>();
  const inside = sectionsUnder(section, projects);
  const records = [section, ...inside].reduce((sum, entry) => sum + (summaryByProject.get(entry.id)?.taskCount ?? 0), 0);
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const takes = [records > 0 ? plural(records, "record") : null, inside.length > 0 ? plural(inside.length, "section") : null].filter(
    (part): part is string => part !== null,
  );
  const remove = async () => {
    const result = await folders
      .call("deleteSection", { boardId: section.id })
      .catch((error: unknown) => ({ ok: false as const, message: error instanceof Error ? error.message : String(error) }));
    // The dialog has closed by now: the row it was opened from shows a refusal.
    if (result.ok) onDeleted(new Set([section.id, ...inside.map((entry) => entry.id)]));
    else onFailed(result.message);
  };
  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Delete ${section.name}?`}
      description={
        <>
          {takes.length === 0 ? "The section is empty." : `${takes.join(" and ")} go with it.`} It is deleted for everyone on the
          project's database.
        </>
      }
      confirmLabel="Delete"
      destructive
      onConfirm={() => void remove()}
    />
  );
}

/** The level switch of the project tree: shows the projects alone, or down to the sections of a depth. */
function FoldSwitch({ nodes, closed, onFold }: { nodes: readonly SectionNode[]; closed: ReadonlySet<string>; onFold: (level: number) => void }) {
  const levels = foldLevels(nodes);
  if (levels.length < 2) return null;
  const level = foldedLevel(nodes, closed);
  return (
    <Segments
      label="Show levels"
      value={level === null ? "" : String(level)}
      options={levels.map((entry) => ({ value: String(entry), label: String(entry) }))}
      onChange={(value) => onFold(Number(value))}
      className="ml-auto w-auto shrink-0 [&_button]:h-5 [&_button]:min-w-5 [&_button]:px-1"
    />
  );
}

function SidebarSkeleton({ pending }: { pending: readonly string[] }) {
  return (
    <DelayedLoading>
      <SidebarSkeletonContent pending={pending} />
    </DelayedLoading>
  );
}

// The sidebar's data RPCs (listProjects, sidebarSummary — plain local DB
// reads) have no timeout, so a stuck request looks identical to a fast one:
// endless shimmer. Naming what's still pending, plus elapsed time, turns "is
// this ever going to load, and what for?" into a fact instead of a guess.
function SidebarSkeletonContent({ pending }: { pending: readonly string[] }) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const tick = () => setElapsedMs(Date.now() - startedAt);
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="space-y-2 px-2 pt-2">
      {["w-3/4", "w-2/3", "w-4/5", "w-3/5", "w-2/3"].map((width, index) => (
        <div className="flex h-7 items-center gap-2 px-2" key={index}>
          <Skeleton className="size-3 rounded-sm" />
          <Skeleton className={cn("h-3", width)} />
        </div>
      ))}
      <div className="px-2 pt-1 text-xs tabular-nums text-muted-foreground">
        Waiting on {pending.length > 0 ? pending.join(", ") : "…"} —{" "}
        {(elapsedMs / 1000).toFixed(1)}s
      </div>
    </div>
  );
}

export interface TasksSidebarProps {
  route: TasksRoute;
  folders: Folder[] | undefined;
  projects: Project[] | undefined;
  summaries: SidebarProjectSummary[] | undefined;
  presets: Preset[] | undefined;
  activeTasks: Task[] | undefined;
  waitingTasks: Task[] | undefined;
  /** Which sidebar data sets are still in flight — empty once all have loaded. */
  pendingSidebarData: readonly string[];
  onNavigate: (route: TasksRoute) => void;
}

export function TasksSidebar({
  route,
  folders,
  projects,
  summaries,
  presets,
  activeTasks,
  waitingTasks,
  pendingSidebarData,
  onNavigate,
}: TasksSidebarProps) {
  const [collapsedFolders, setCollapsedFolders] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const rpc = useTasksRpc();
  // Views are a navigation section, so the left column owns their query; the
  // Display menu only saves into it.
  const { data: savedViewData, refresh: refreshViews } = useSavedViews();
  const savedViews: readonly SavedView[] = savedViewData ?? [];
  const sectionDrag = useSectionDragState();
  // Keyed remount resets the dialog draft per open/target. Saving publishes
  // projects:changed, which refreshes the shell's presets query.
  const [presetDialog, setPresetDialog] = useState<{
    key: number;
    editing: Preset | null;
  } | null>(null);
  const summaryByProject = useMemo(
    () => new Map((summaries ?? []).map((entry) => [entry.projectId, entry])),
    [summaries],
  );
  const totalTasks = useMemo(
    () => (summaries ?? []).reduce((sum, entry) => sum + entry.taskCount, 0),
    [summaries],
  );
  const activeProjectId = route.kind === "project" ? route.projectId : null;
  // No explicit view: the shell restores the view last used for that project.
  const openProject = (projectId: string) =>
    onNavigate({ kind: "project", projectId, view: null });
  const toggleFolder = (folderId: string) =>
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });

  const allProjects = projects ?? [];
  // A table is drawn under its project, not in a list of its own.
  const ungrouped = allProjects.filter((p) => p.folderId === null && !isTable(p));
  const [closed, setClosed] = useClosedSections();
  const toggleSection = (projectId: string) => setClosed((current) => toggleOpen(current, projectId));
  const entry = (project: Project) => (
    <ProjectEntry
      key={project.id}
      project={project}
      projects={allProjects}
      summaryByProject={summaryByProject}
      activeProjectId={activeProjectId}
      onOpen={openProject}
      closed={closed}
      onToggle={toggleSection}
    />
  );
  const roots = allProjects.filter((p) => !isTable(p));
  const tree = sectionTree(roots, allProjects);
  // Folding to a level sets every branch of every project, in a folder or not.
  const fold = (level: number) => setClosed(() => closedAtDepth(tree, level));
  const foldSwitch = <FoldSwitch nodes={tree} closed={closed} onFold={fold} />;
  /** The arrows walk a list of projects as a tree: up and down the drawn rows, right opens or goes in, left closes or goes out. */
  const walk = (list: readonly Project[]) => (event: KeyboardEvent<HTMLDivElement>) => {
    const current = (event.target as HTMLElement).closest<HTMLElement>("[data-tree-row]")?.dataset.treeRow ?? null;
    if (current === null) return;
    const rows = treeRows(sectionTree(list, allProjects), closed);
    // A nested folder's list sits inside its parent's: the row is the inner list's, and the outer one leaves it alone.
    if (!rows.some((row) => row.id === current)) return;
    const move = treeKey(rows, current, event.key);
    if (move.current === current && move.toggle === null) return;
    event.preventDefault();
    if (move.toggle !== null) toggleSection(move.toggle);
    if (move.current !== null && move.current !== current) {
      const target = move.current;
      Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-tree-row]")).find((row) => row.dataset.treeRow === target)?.focus();
    }
  };
  const rootFolders = (folders ?? []).filter((f) => f.parentFolderId === null);
  const childFolders = (folders ?? []).filter((f) => f.parentFolderId !== null);

  const renderFolder = (folder: Folder, indent: boolean) => {
    const collapsed = collapsedFolders.has(folder.id);
    const folderProjects = allProjects.filter(
      (p) => p.folderId === folder.id && !isTable(p),
    );
    const children = childFolders.filter((f) => f.parentFolderId === folder.id);
    return (
      <div key={folder.id} className={cn(indent && "pl-3")}>
        <SectionHeader
          label={folder.name}
          collapsed={collapsed}
          onToggle={() => toggleFolder(folder.id)}
          // With no Projects header, the level switch stands over the first folder.
          trailing={ungrouped.length === 0 && folder.id === rootFolders[0]?.id ? foldSwitch : undefined}
        />
        {!collapsed ? (
          <div className="space-y-px" onKeyDown={walk(folderProjects)}>
            {folderProjects.map(entry)}
            {/* Folders nest one level; children only render under roots. */}
            {!indent
              ? children.map((child) => renderFolder(child, true))
              : null}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <SectionDragContext.Provider value={sectionDrag}>
      <div className="flex h-full min-h-0 flex-col bg-sidebar">
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-2">
          <div className="space-y-px">
            <SidebarRow
              active={route.kind === "all"}
              onClick={() => onNavigate({ kind: "all", view: null })}
            >
              <Icon name="ListView" className="size-3.5 shrink-0" />
              <span className="flex-1">All tasks</span>
              {summaries ? <RowCount value={totalTasks} /> : null}
            </SidebarRow>
            <SidebarRow
              active={route.kind === "active"}
              onClick={() => onNavigate({ kind: "active", view: null })}
            >
              <Icon name="Zap" className="size-3.5 shrink-0" />
              <span className="flex-1">Active</span>
              {activeTasks && activeTasks.length > 0 ? <WorkingDot /> : null}
              {activeTasks ? <RowCount value={activeTasks.length} /> : null}
            </SidebarRow>
            <SidebarRow
              active={route.kind === "waiting"}
              onClick={() => onNavigate({ kind: "waiting", view: null })}
            >
              <Icon name="Clock" className="size-3.5 shrink-0" />
              <span className="flex-1">Waiting</span>
              {waitingTasks ? <RowCount value={waitingTasks.length} /> : null}
            </SidebarRow>
            <SidebarRow
              active={route.kind === "analytics"}
              onClick={() => onNavigate({ kind: "analytics" })}
            >
              <Icon name="ChartColumn" className="size-3.5 shrink-0" />
              <span className="flex-1">Analytics</span>
            </SidebarRow>
          </div>
          {savedViews.length > 0 ? (
            <>
              <SectionHeader label="Views" />
              <div className="space-y-px">
                {savedViews.map((view) => (
                  <ViewRow
                    key={view.id}
                    view={view}
                    active={
                      route.kind === "view" && route.savedViewId === view.id
                    }
                    onOpen={() =>
                      onNavigate({ kind: "view", savedViewId: view.id })
                    }
                    onRename={(name) => {
                      void rpc
                        .call("updateSavedView", { savedViewId: view.id, name })
                        .then(() => refreshViews());
                    }}
                    onDelete={() => {
                      void rpc
                        .call("deleteSavedView", { savedViewId: view.id })
                        .then(() => refreshViews());
                    }}
                  />
                ))}
              </div>
            </>
          ) : null}
          {pendingSidebarData.length > 0 ? (
            <SidebarSkeleton pending={pendingSidebarData} />
          ) : (
            <>
              {ungrouped.length > 0 ? (
                <>
                  <SectionHeader label="Projects" trailing={foldSwitch} />
                  <div className="space-y-px" onKeyDown={walk(ungrouped)}>
                    {ungrouped.map(entry)}
                  </div>
                </>
              ) : null}
              {rootFolders.map((folder) => renderFolder(folder, false))}
              {presets ? (
                <>
                  <SectionHeader label="Agent presets" />
                  <div className="space-y-px">
                    {presets.map((preset) => (
                      <SidebarRow
                        key={preset.id}
                        title={`Edit preset ${preset.name}`}
                        onClick={() =>
                          setPresetDialog({ key: Date.now(), editing: preset })
                        }
                      >
                        <Icon name="Brain" className="size-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">
                          {preset.name}
                        </span>
                        {preset.environmentKind === "new-worktree" ? (
                          <TooltipProvider delayDuration={300}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  aria-label="Spawns a new worktree"
                                  className="flex shrink-0 text-muted-foreground/70"
                                >
                                  <Icon name="GitBranch" className="size-3" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="left">
                                Spawns a new worktree
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : null}
                      </SidebarRow>
                    ))}
                    {presets.length === 0 ? (
                      <div className="px-2 py-1 text-xs text-muted-foreground">
                        No presets yet.
                      </div>
                    ) : null}
                    <SidebarRow
                      title="New preset"
                      onClick={() =>
                        setPresetDialog({ key: Date.now(), editing: null })
                      }
                    >
                      <Icon name="Plus" className="size-3.5 shrink-0" />
                      <span className="flex-1">New preset</span>
                    </SidebarRow>
                  </div>
                </>
              ) : null}
            </>
          )}
        </nav>
        <div className="shrink-0 border-t border-border-hairline px-2 py-1.5">
          <SidebarRow
            active={route.kind === "manage"}
            onClick={() => onNavigate({ kind: "manage" })}
          >
            <Icon name="Settings" className="size-3.5 shrink-0" />
            <span className="flex-1">Manage</span>
          </SidebarRow>
        </div>
        {presetDialog ? (
          <PresetDialog
            key={presetDialog.key}
            open
            onOpenChange={(open) => {
              if (!open) setPresetDialog(null);
            }}
            editing={presetDialog.editing}
            onSave={(draft) => savePresetDraft(rpc, presetDialog.editing, draft)}
          />
        ) : null}
      </div>
    </SectionDragContext.Provider>
  );
}
