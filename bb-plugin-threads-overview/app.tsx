// bb-plugin-threads-overview — frontend.
//
// A home-screen section listing threads that need the user: any thread where no
// work is going on and that the user has not postponed. The list itself comes
// from the host's live sidebar view (`experimental_useSidebarThreads`), so it
// updates exactly when the sidebar does — no polling, all projects at once. The
// only thing the backend holds is the Postpone marks, read over rpc and kept in
// sync through the `postpone-changed` realtime channel.
//
// Row actions go through the host's own thread actions, so archiving here
// behaves exactly as archiving from the built-in sidebar.
//
// The same conversation preview opens on hover over the rows of bb's own
// sidebar: the plugin offers a thread list that renders bb's list unchanged
// and only watches the pointer over its thread rows.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import {
  ThreadChat,
  definePluginApp,
  experimental_useProviders,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreadPullRequest,
  experimental_useSidebarThreadSplit,
  experimental_useSidebarThreads,
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRpc,
  useSettings,
  type PluginSidebarThread,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./server";
import {
  attentionQueue,
  edgeBleed,
  groupByProject,
  nearestSlideIndex,
  type ProjectGroup,
  type SortKey,
  type Span,
  type ThreadFacts,
} from "./src/core/attention";
import { formatWaitingSince } from "./src/core/format";
import { composerKeyMove, queueKeyMove } from "./src/core/keys";
import { sidePaneSteps } from "./src/core/open";
import { hasRoomBelow, reachesHome, startsHomeSwipe, type Point } from "./src/core/home-swipe";
import {
  holdsGesture,
  swipeAxis,
  swipeOffset,
  swipeSettlesOpen,
  type SwipeAxis,
} from "./src/core/swipe";
import { describeFooter, type ExecutionFacts, type GitFacts } from "./src/core/details";
import { parsePreviewDelayMs } from "./src/core/preview";
import { parsePreviewSize } from "./src/core/preview-size";
import { rowStatus, worktreeOf, type RowStatus, type Worktree } from "./src/core/status";
import { ProviderLogo, type ProviderBrand } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon, type IconName } from "@/components/ui/icon";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const POSTPONE_CHANGED_CHANNEL = "postpone-changed";

// A phone or tablet: no hover to preview on, and swipes instead of always-visible row actions.
const TOUCH_QUERY = "(pointer: coarse)";

const SECTION_TITLE = "Требуют внимания";

const SORTS: readonly { key: SortKey; label: string }[] = [
  { key: "waiting-longest", label: "Дольше ждут" },
  { key: "waiting-newest", label: "Свежие" },
];

// Room between two project slides, so a hovered row's fill ends well short of
// the neighbouring list's logos and buttons instead of running into them.
const SLIDE_GAP = "gap-8";

function threadTitle(thread: PluginSidebarThread): string {
  return thread.title ?? thread.titleFallback ?? "Без названия";
}

function toFacts(thread: PluginSidebarThread): ThreadFacts {
  return {
    id: thread.id,
    projectId: thread.projectId,
    isArchived: thread.isArchived,
    hasPendingInteraction: thread.hasPendingInteraction,
    indicator: thread.indicator,
    activity: thread.activity,
    latestAttentionAt: thread.latestAttentionAt,
  };
}

/**
 * A thread's provider resolved to a name, logo and brand tint through the
 * host's own provider directory. While the directory loads or fails every
 * lookup is null, and rows keep an empty logo slot until it is ready.
 */
function useProviderLookup(): (providerId: string) => ProviderBrand | null {
  const { providers } = experimental_useProviders();
  return useMemo(() => {
    const brands = new Map<string, ProviderBrand>(
      providers.map((provider) => [
        provider.id,
        {
          name: provider.displayName,
          logoUrl: provider.logoUrl,
          tint: provider.strings?.iconTint ?? null,
        },
      ]),
    );
    return (providerId: string) => brands.get(providerId) ?? null;
  }, [providers]);
}

/** Postpone marks, loaded over rpc and kept live; mutations are optimistic. */
function usePostpone() {
  const rpc = useRpc<typeof rpcContract>();
  const [postponedIds, setPostponedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );

  const refetch = useCallback(async () => {
    try {
      const { postponed } = await rpc.call("listPostponed");
      setPostponedIds(new Set(postponed.map((entry) => entry.threadId)));
    } catch {
      // Keep whatever we had; a failed read must not empty the queue's filter.
    }
    // rpc is a fresh client per render; depending on it would refetch in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useRealtime(POSTPONE_CHANGED_CHANNEL, () => {
    void refetch();
  });

  const setPostponed = useCallback(
    async (threadId: string, postponed: boolean) => {
      setPostponedIds((prev) => {
        const next = new Set(prev);
        if (postponed) next.add(threadId);
        else next.delete(threadId);
        return next;
      });
      try {
        await rpc.call("setPostponed", { threadId, postponed });
      } catch {
        toast.error("Не удалось сохранить отметку");
        void refetch();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refetch],
  );

  return { postponedIds, setPostponed };
}

// The key predates the rename to threads-overview; kept so saved filters survive it.
const FILTERS_STORAGE_KEY = "bb-plugin-attention:filters";

/** Where a pressed row opens its thread: in place of the current pane, or in a split beside it. */
type OpenMode = "full" | "split";

const OPEN_MODES: readonly MenuOption<OpenMode>[] = [
  { key: "full", label: "На весь экран", itemLabel: "Открывать на весь экран" },
  { key: "split", label: "В боковой панели", itemLabel: "Открывать в боковой панели" },
];

interface Filters {
  sort: SortKey;
  grouped: boolean;
  openMode: OpenMode;
}

const DEFAULT_FILTERS: Filters = { sort: "waiting-longest", grouped: false, openMode: "full" };

function isSortKey(value: unknown): value is SortKey {
  return value === "waiting-longest" || value === "waiting-newest";
}

function isOpenMode(value: unknown): value is OpenMode {
  return value === "full" || value === "split";
}

function loadFilters(): Filters {
  try {
    const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY);
    if (raw === null) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw) as Partial<Filters>;
    return {
      sort: isSortKey(parsed.sort) ? parsed.sort : DEFAULT_FILTERS.sort,
      grouped:
        typeof parsed.grouped === "boolean" ? parsed.grouped : DEFAULT_FILTERS.grouped,
      openMode: isOpenMode(parsed.openMode) ? parsed.openMode : DEFAULT_FILTERS.openMode,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

/** Which sort, grouping and open mode the user left the queue in, kept across reloads. */
function useFilters() {
  const [filters, setFilters] = useState<Filters>(loadFilters);

  const persist = useCallback((next: Filters) => {
    setFilters(next);
    try {
      window.localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // A blocked or full store must not break the toggle itself.
    }
  }, []);

  return {
    sort: filters.sort,
    grouped: filters.grouped,
    openMode: filters.openMode,
    setSort: useCallback(
      (sort: SortKey) => persist({ ...filters, sort }),
      [filters, persist],
    ),
    setOpenMode: useCallback(
      (openMode: OpenMode) => persist({ ...filters, openMode }),
      [filters, persist],
    ),
    toggleGrouped: useCallback(
      () => persist({ ...filters, grouped: !filters.grouped }),
      [filters, persist],
    ),
  };
}

/** A row action with no label of its own: the tooltip carries the words. */
function RowAction({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: IconName;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          className={cn("size-7 shrink-0", ABOVE_ROW_TARGET)}
          onClick={onClick}
        >
          <Icon name={icon} className="size-3.5" aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The thread's conversation beside a row after a hover delay. Off is off: with
 * no delay configured the row is not a hover target at all, so nothing waits,
 * mounts, or fetches behind the scenes.
 */
/** What the backend adds to the footer; null until it answers, and if it fails. */
function useThreadDetails(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [details, setDetails] = useState<{
    execution: ExecutionFacts | null;
    git: GitFacts | null;
  } | null>(null);

  useEffect(() => {
    let live = true;
    rpc
      .call("threadDetails", { threadId })
      .then((answer) => {
        if (live) setDetails(answer);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // rpc is a fresh client per render; depending on it would refetch in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  return details;
}

/** The footer as up to three lines of short items. */
function PreviewFooter({ thread }: { thread: PluginSidebarThread }) {
  const { projects } = experimental_useSidebarThreads();
  const { pullRequest } = experimental_useSidebarThreadPullRequest(thread.id);
  const details = useThreadDetails(thread.id);
  const footer = describeFooter({
    projectName: projects.find((project) => project.id === thread.projectId)?.name ?? "—",
    branchName: thread.environment?.branchName ?? null,
    inWorktree: worktreeOf(thread.environment) !== null,
    hostName: thread.host?.name ?? null,
    execution: details?.execution ?? null,
    git: details?.git ?? null,
    pullRequest: pullRequest && { number: pullRequest.number, state: pullRequest.state },
  });
  const lines = [footer.place, footer.execution, footer.work].filter((line) => line.length > 0);

  return (
    <footer
      data-testid="thread-preview-footer"
      className="flex shrink-0 flex-col gap-0.5 border-t border-border px-3 py-2 text-xs text-muted-foreground"
    >
      {lines.map((line, lineIndex) => (
        <p key={lineIndex} className="flex flex-wrap items-center gap-x-1.5">
          {line.flatMap((item, index) => [
            index > 0 && (
              <span key={`dot-${index}`} aria-hidden>
                ·
              </span>
            ),
            <span key={index}>{item}</span>,
          ])}
        </p>
      ))}
    </footer>
  );
}

/**
 * The preview window itself, one for the home screen and the sidebar: the
 * thread's title, its conversation, and a footer on where and how it runs.
 */
function PreviewCard({ threadId }: { threadId: string }) {
  const { threads } = experimental_useSidebarThreads();
  const settings = useSettings();
  const size = parsePreviewSize(settings.values?.previewWidth, settings.values?.previewHeight);
  const thread = threads.find((candidate) => candidate.id === threadId);

  return (
    <div
      data-testid="thread-preview"
      className="flex flex-col"
      style={{ width: `${size.width}px`, maxHeight: `min(${size.height}px, 100vh)` }}
    >
      <h3 className="shrink-0 truncate border-b border-border px-3 py-2 text-sm font-semibold text-foreground">
        {thread ? threadTitle(thread) : "Без названия"}
      </h3>
      {/* "document" grows to the conversation's own height, so a short one
          gives a short window and only a long one reaches the ceiling. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ThreadChat threadId={threadId} variant="timeline" layout="document" />
      </div>
      {thread && <PreviewFooter thread={thread} />}
    </div>
  );
}

function ThreadPreview({
  threadId,
  delayMs,
  children,
}: {
  threadId: string;
  delayMs: number;
  children: ReactElement;
}) {
  if (delayMs === 0) return children;
  return (
    <HoverCard openDelay={delayMs} closeDelay={100}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent align="start" side="right" className="w-auto overflow-hidden p-0">
        <PreviewCard threadId={threadId} />
      </HoverCardContent>
    </HoverCard>
  );
}

// How long the window stays after the pointer leaves the row, so it can be reached.
const SIDEBAR_CLOSE_DELAY_MS = 150;

const threadRowOf = (node: EventTarget | null): HTMLElement | null =>
  node instanceof Element ? node.closest<HTMLElement>("[data-sidebar-thread-id]") : null;

/**
 * bb's own thread list, untouched, with the conversation preview on hover over
 * its thread rows. The rows are the host's, so the list tells them apart only
 * by the thread id the host marks each one with.
 */
function SidebarWithPreview({ Original }: PluginThreadListProps) {
  const settings = useSettings();
  const touch = useMediaQuery(TOUCH_QUERY);
  const delayMs = touch ? 0 : parsePreviewDelayMs(settings.values?.previewDelaySeconds);
  const [open, setOpen] = useState<{ threadId: string; anchor: HTMLElement } | null>(null);
  const opening = useRef<{ threadId: string; timer: number } | null>(null);
  const closing = useRef<number | null>(null);

  const cancelOpening = () => {
    if (opening.current) window.clearTimeout(opening.current.timer);
    opening.current = null;
  };
  const cancelClosing = () => {
    if (closing.current !== null) window.clearTimeout(closing.current);
    closing.current = null;
  };
  const scheduleClose = () => {
    cancelOpening();
    if (closing.current !== null) return;
    closing.current = window.setTimeout(() => {
      closing.current = null;
      setOpen(null);
    }, SIDEBAR_CLOSE_DELAY_MS);
  };

  useEffect(() => () => {
    cancelOpening();
    cancelClosing();
  }, []);

  const onPointerOver = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse" || delayMs === 0) return;
    // React bubbles the portalled window's events up here too; only the list's own count.
    if (!event.currentTarget.contains(event.target as Node)) return;
    const row = threadRowOf(event.target);
    const threadId = row?.dataset.sidebarThreadId;
    if (!row || !threadId) {
      scheduleClose();
      return;
    }
    cancelClosing();
    if (open?.threadId === threadId || opening.current?.threadId === threadId) return;
    cancelOpening();
    opening.current = {
      threadId,
      timer: window.setTimeout(() => {
        opening.current = null;
        setOpen({ threadId, anchor: row });
      }, delayMs),
    };
  };

  return (
    <div className="contents" onPointerOver={onPointerOver} onPointerLeave={scheduleClose}>
      <Original />
      <Popover open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        {open && <PopoverAnchor virtualRef={{ current: open.anchor }} />}
        {open && (
          <PopoverContent
            align="start"
            side="right"
            className="w-auto overflow-hidden p-0"
            onOpenAutoFocus={(event) => event.preventDefault()}
            onPointerEnter={cancelClosing}
            onPointerLeave={scheduleClose}
          >
            <PreviewCard threadId={open.threadId} />
          </PopoverContent>
        )}
      </Popover>
    </div>
  );
}

/**
 * A row is a grid, not a flex line: the logo fills the row's height and stays
 * square, and only a grid track gives it a definite height to take its width
 * from. In a flex line the stretched square collapses to zero width.
 */
// The divider sits on the row itself (border-b), not the list (divide-y): a
// hovered row needs to drop both its own divider and the one above it, and
// only a border a row owns can be turned off by that row's own hover state
// or by its next sibling's — `has-[+li:hover]` reads as "the next li is
// hovered", which is the row above reacting to the row below being hovered.
//
// The row reaches 8px past the column on each side and pads the same back, so
// the rounded fill leaves room around the logo and buttons while they stay in
// line with the section heading. `isolate` keeps the z-index lifted over the
// row's hit area inside the row, clear of the host's own layers.
const ROW_SHELL_CLASS =
  "relative isolate -mx-2 rounded-lg border-b border-border last:border-b-0 has-[[data-queue-row]:focus-visible]:border-b-transparent has-[[data-queue-row]:focus-visible]:bg-state-hover has-[[data-queue-row]:focus-visible]:ring-1 has-[[data-queue-row]:focus-visible]:ring-ring";
// Hovering belongs to a pointer that can hover. On a touch screen the row's
// fill lives under its own sliding part, where nothing would show it, while
// the divider is outside and does gutter out — a phone that keeps a stale
// hover on the last row it was tapped on leaves that row with neither.
const ROW_HOVER_CLASS =
  "hover:border-b-transparent hover:bg-state-hover has-[+li:hover]:border-b-transparent";
const ROW_GRID_CLASS = "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-2 py-2";
const ROW_CLASS = cn(ROW_SHELL_CLASS, ROW_HOVER_CLASS, ROW_GRID_CLASS);
// The whole row opens the thread, yet it holds a single button: the title's
// button stretches its hit area over the row with a pseudo-element.
const ROW_TARGET_CLASS =
  "flex min-w-0 cursor-pointer flex-col items-start text-left after:absolute after:inset-0 focus-visible:outline-none";
// What must stay reachable over that stretched hit area: row actions and marks.
const ABOVE_ROW_TARGET = "relative z-10";
// 70% of the row's height (a 30% reduction), centred on the grid's own
// cross-axis alignment rather than stretched — `self-center` needs the same
// definite row height `self-stretch` used to, so the percentage still resolves.
const ROW_LOGO_CLASS = "size-auto aspect-square h-[70%] w-auto self-center";

/** A glyph that means something on its own: labelled for screen readers, worded in a tooltip. */
function RowMark({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={label}
          className={cn("inline-flex shrink-0 items-center", ABOVE_ROW_TARGET)}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

// The same glyphs bb's own sidebar paints for these indicators.
const STATUS_MARKS: Record<RowStatus, { label: string; hint: string; glyph: ReactNode }> = {
  "unread-success": {
    label: "Новое сообщение",
    hint: "Новое сообщение — ответ ещё не прочитан",
    glyph: <span className="size-[5px] rounded-full bg-muted-foreground/60" />,
  },
  "unread-error": {
    label: "Новое сообщение с ошибкой",
    hint: "Ход закончился ошибкой — ответ ещё не прочитан",
    glyph: <Icon name="CircleX" className="size-4 text-destructive" aria-hidden />,
  },
  "waiting-for-input": {
    label: "Ждёт ответа",
    hint: "Агент ждёт твоего ответа или одобрения",
    glyph: <Icon name="CircleQuestion" className="size-4 text-muted-foreground/75" aria-hidden />,
  },
};

/** Sized like a row action, so a status and the Archive button take one slot. */
function StatusMark({ status }: { status: RowStatus }) {
  const mark = STATUS_MARKS[status];
  return (
    <span className="inline-flex size-7 shrink-0 items-center justify-center">
      <RowMark label={mark.label} hint={mark.hint}>
        {mark.glyph}
      </RowMark>
    </span>
  );
}

function WorktreeMark({ worktree }: { worktree: Worktree }) {
  return (
    <RowMark
      label="Рабочее дерево"
      hint={
        worktree.branch === null
          ? "Тред работает в своём рабочем дереве"
          : `Тред работает в рабочем дереве ${worktree.branch}`
      }
    >
      <Icon name="FolderGit" className="size-3.5" aria-hidden />
    </RowMark>
  );
}

/** The line under a title: the worktree the thread runs in, if any, then the project. */
function RowCaption({
  projectLabel,
  worktree,
}: {
  projectLabel: string;
  worktree: Worktree | null;
}) {
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      {worktree !== null && <WorktreeMark worktree={worktree} />}
      {projectLabel}
    </span>
  );
}

interface RowProps {
  thread: ThreadFacts;
  title: string;
  /** Null inside a project group, where the slide already names the project. */
  projectLabel: string | null;
  worktree: Worktree | null;
  provider: ProviderBrand | null;
  now: number;
  /** Hover before the conversation opens; 0 keeps the preview off entirely. */
  previewDelayMs: number;
  /** A touch screen: the row actions hide in a tray a swipe reveals. */
  touch: boolean;
  swipeOpen: boolean;
  onSwipeOpenChange: (open: boolean) => void;
  onOpen: () => void;
  onPostpone: () => void;
  onArchive: () => void;
}

function ThreadRow({
  thread,
  title,
  projectLabel,
  worktree,
  provider,
  now,
  previewDelayMs,
  touch,
  swipeOpen,
  onSwipeOpenChange,
  onOpen,
  onPostpone,
  onArchive,
}: RowProps) {
  const status = rowStatus(thread);
  const logo = (
    <ProviderLogo provider={provider} className={cn(ROW_LOGO_CLASS, "text-muted-foreground")} />
  );
  const target = (
    <button type="button" onClick={onOpen} className={ROW_TARGET_CLASS} data-queue-row={thread.id}>
      {/* Inside a group there is no caption line, so the worktree mark closes the title's. */}
      <span className="flex w-full items-center gap-1">
        <span className="truncate text-sm">{title}</span>
        {projectLabel === null && worktree !== null && <WorktreeMark worktree={worktree} />}
      </span>
      {projectLabel !== null && <RowCaption projectLabel={projectLabel} worktree={worktree} />}
    </button>
  );
  const waiting = (
    <span className="px-1 text-xs text-muted-foreground">
      {formatWaitingSince(now, thread.latestAttentionAt)}
    </span>
  );
  const postpone = (
    <RowAction
      icon="Clock"
      label="Отложить"
      hint="Отложить — убрать из списка, пока в треде не возобновится работа"
      onClick={onPostpone}
    />
  );
  // A status means the thread still holds something for you, so it is not ready to archive.
  const archive = status === null && (
    <RowAction
      icon="Archive"
      label="Архивировать"
      hint="Архивировать тред вместе с дочерними"
      onClick={onArchive}
    />
  );

  if (touch) {
    return (
      <li className={cn(ROW_SHELL_CLASS, "overflow-hidden")}>
        <SwipeRow
          open={swipeOpen}
          onOpenChange={onSwipeOpenChange}
          actions={
            <>
              {postpone}
              {archive}
            </>
          }
        >
          {logo}
          {target}
          <span className="flex items-center gap-1">
            {waiting}
            {status !== null && <StatusMark status={status} />}
          </span>
        </SwipeRow>
      </li>
    );
  }

  return (
    <ThreadPreview threadId={thread.id} delayMs={previewDelayMs}>
      <li className={ROW_CLASS}>
        {logo}
        {target}
        <span className="flex items-center gap-1">
          {waiting}
          {postpone}
          {archive || (status !== null && <StatusMark status={status} />)}
        </span>
      </li>
    </ThreadPreview>
  );
}

// Until the tray is laid out — its first frame, or a DOM with no layout — it is taken as two buttons wide.
const SWIPE_TRAY_FALLBACK_WIDTH = 64;

/**
 * A row on a touch screen: its actions wait in a tray under the right edge and
 * come out when the row is swiped from right to left — see `swipeAxis`,
 * `swipeOffset` and `swipeSettlesOpen`. An upright drag stays the page's
 * scroll. The drag's own click is swallowed, and a tap on an open row closes
 * it rather than opening the thread.
 *
 * The row's own fill is what hides the tray: the sliding part is opaque and
 * painted a storey above it. Both storeys are needed — the tray's buttons are
 * lifted over the row's stretched hit area (`ABOVE_ROW_TARGET`), and without a
 * storey of its own the sliding part stays under them, so the actions show
 * through over the waiting time of every closed row. The tray's `z-0` is not
 * the nothing it looks like either: a storey of its own is what shuts those
 * lifted buttons inside it, where they can no longer climb over the fill.
 */
function SwipeRow({
  open,
  onOpenChange,
  actions,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: ReactNode;
  children: ReactNode;
}) {
  const trayRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; axis: SwipeAxis; dx: number } | null>(null);
  const swallowClick = useRef(false);
  const [dragDx, setDragDx] = useState<number | null>(null);
  const trayWidth = () => trayRef.current?.offsetWidth || SWIPE_TRAY_FALLBACK_WIDTH;
  const offset = dragDx === null ? (open ? -trayWidth() : 0) : swipeOffset(open, dragDx, trayWidth());

  // A swipe that has gone sideways is the row's, not the page's — see
  // `holdsGesture`. `touch-pan-y` alone leaves the upright half of every drag
  // to the browser, which starts scrolling the moment the finger drifts down —
  // over a row's height, say — and cancels the pointer, snapping the row back
  // mid-swipe. Stopping the browser's own `touchmove` keeps the gesture here
  // until the finger lifts; it has to be a listener of our own, since React's
  // is passive and cannot. It rests on the pointer event coming first: the
  // compatibility rules of Pointer Events put `pointermove` before the
  // `touchmove` of the same finger, so the axis is already decided here.
  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    const hold = (event: TouchEvent) => {
      if (holdsGesture(drag.current?.axis ?? "undecided", event.cancelable)) {
        event.preventDefault();
      }
    };
    panel.addEventListener("touchmove", hold, { passive: false });
    return () => panel.removeEventListener("touchmove", hold);
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") return;
    swallowClick.current = false;
    drag.current = { x: event.clientX, y: event.clientY, axis: "undecided", dx: 0 };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current === null) return;
    const dx = event.clientX - current.x;
    if (current.axis === "undecided") {
      current.axis = swipeAxis(dx, event.clientY - current.y);
      if (current.axis === "vertical") {
        drag.current = null;
        return;
      }
      if (current.axis === "undecided") return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    current.dx = dx;
    setDragDx(dx);
  };
  const onPointerEnd = () => {
    const current = drag.current;
    drag.current = null;
    if (current === null || current.axis !== "horizontal") return;
    swallowClick.current = true;
    setDragDx(null);
    onOpenChange(swipeSettlesOpen(open, current.dx, trayWidth()));
  };
  const onClickCapture = (event: React.MouseEvent) => {
    if (!swallowClick.current && !open) return;
    event.preventDefault();
    event.stopPropagation();
    if (swallowClick.current) swallowClick.current = false;
    else onOpenChange(false);
  };

  return (
    <>
      <span
        ref={trayRef}
        data-swipe-tray=""
        inert={!open}
        aria-hidden={!open}
        className="absolute inset-y-0 right-0 z-0 flex items-center gap-1 pr-2"
      >
        {actions}
      </span>
      <div
        ref={panelRef}
        data-swipe-row=""
        className={cn(
          ROW_GRID_CLASS,
          "relative z-10 touch-pan-y bg-background",
          dragDx === null && "transition-transform duration-200",
        )}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
    </>
  );
}

/** A postponed thread: the same logo, title, project and preview as a queue row, with a way back. */
function PostponedRow({
  thread,
  title,
  projectLabel,
  provider,
  previewDelayMs,
  onOpen,
  onRestore,
}: {
  thread: PluginSidebarThread;
  title: string;
  projectLabel: string;
  provider: ProviderBrand | null;
  previewDelayMs: number;
  onOpen: () => void;
  onRestore: () => void;
}) {
  return (
    <ThreadPreview threadId={thread.id} delayMs={previewDelayMs}>
      <li className={ROW_CLASS}>
        <ProviderLogo
          provider={provider}
          className={cn(ROW_LOGO_CLASS, "text-muted-foreground")}
        />
        <button type="button" onClick={onOpen} className={ROW_TARGET_CLASS}>
          <span className="w-full truncate text-sm text-muted-foreground">{title}</span>
          <RowCaption
            projectLabel={projectLabel}
            worktree={worktreeOf(thread.environment)}
          />
        </button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={ABOVE_ROW_TARGET}
          onClick={onRestore}
        >
          <Icon name="ArrowTurnBackward" className="size-3.5" aria-hidden />
          Вернуть
        </Button>
      </li>
    </ThreadPreview>
  );
}

/**
 * Tracks which project slide is centred in the horizontal snap track.
 *
 * Scroll snapping is the host's own scrolling, so a trackpad swipe, a touch
 * swipe and a dragged scrollbar all land on a slide; the pills above scroll to
 * one. Focus follows the swipe: the slide nearest the centre of the viewport
 * is lit and the rest are dimmed. The index is read back from scroll geometry —
 * on every scroll, and once more whenever a group comes or goes, since that
 * moves the slides under a track that reports no scroll event of its own.
 */
function useGroupTrack(groupCount: number) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const bleed = useTrackBleed(trackRef, groupCount > 0);

  const syncActive = useCallback(() => {
    const track = trackRef.current;
    if (track === null) return;
    const centers = Array.from(track.children).map((slide) => {
      const element = slide as HTMLElement;
      return element.offsetLeft + element.offsetWidth / 2;
    });
    // The bleed is scrollport the section does not own: the section's centre
    // sits midway between the two bleeds, not midway across the scrollport.
    const sectionWidth = track.clientWidth - bleed.left - bleed.right;
    setActive(
      nearestSlideIndex(centers, track.scrollLeft + bleed.left + sectionWidth / 2),
    );
  }, [bleed]);

  // A group can vanish while it is the focused one (its last thread was dealt
  // with), which leaves the track scrolled somewhere new without a scroll event.
  useEffect(syncActive, [syncActive, groupCount]);

  const goTo = useCallback((index: number) => {
    setActive(index);
    trackRef.current?.children[index]?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, []);

  return { trackRef, active, bleed, goTo, syncActive };
}

/** The nearest ancestor that cuts off whatever overflows it sideways — where the track has to stop. */
function clippingAncestor(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    if (getComputedStyle(node).overflowX !== "visible") return node;
  }
  return null;
}

/**
 * How far the track reaches past the section on each side: out to the edges of
 * whatever clips the page — bb's own page scroller, which is as wide as the
 * pane — so neighbouring lists run on across the page instead of ending at the
 * composer's width. The section is re-measured whenever it or that box resizes.
 */
function useTrackBleed(
  trackRef: RefObject<HTMLDivElement | null>,
  mounted: boolean,
): Span {
  const [bleed, setBleed] = useState<Span>({ left: 0, right: 0 });

  useEffect(() => {
    const section = trackRef.current?.parentElement ?? null;
    if (!mounted || section === null || typeof ResizeObserver === "undefined") return;
    const clip = clippingAncestor(section);

    const measure = () => {
      const clipBox =
        clip === null
          ? { left: 0, right: document.documentElement.clientWidth }
          : (() => {
              const left = clip.getBoundingClientRect().left + clip.clientLeft;
              return { left, right: left + clip.clientWidth };
            })();
      const next = edgeBleed(section.getBoundingClientRect(), clipBox);
      setBleed((prev) =>
        prev.left === next.left && prev.right === next.right ? prev : next,
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(section);
    if (clip !== null) observer.observe(clip);
    return () => observer.disconnect();
  }, [trackRef, mounted]);

  return bleed;
}

/** The project pills that pick a slide — a row of their own under the section's header, wrapping instead of clipping. */
function GroupPills({
  groups,
  active,
  onSelect,
}: {
  groups: readonly ProjectGroup[];
  active: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {groups.map((group, index) => (
        <Button
          key={group.projectId}
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={index === active}
          onClick={() => onSelect(index)}
        >
          {group.name}
          <span className="text-muted-foreground">{group.threads.length}</span>
        </Button>
      ))}
    </div>
  );
}

/**
 * The project groups as swipeable slides; the picker for one lives in `GroupPills`, above.
 *
 * Only the focused slide is a list of threads. A dimmed one is a single target:
 * its rows are inert and let the pointer through, so hovering anywhere on it
 * lights the whole slide up and a click brings it to the centre. Keyboard users
 * reach it through its pill.
 */
function GroupedQueue({
  groups,
  active,
  bleed,
  trackRef,
  onScroll,
  onSelect,
  renderRow,
}: {
  groups: readonly ProjectGroup[];
  active: number;
  bleed: Span;
  trackRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onSelect: (index: number) => void;
  renderRow: (thread: ThreadFacts, focused: boolean) => ReactNode;
}) {
  // The padding brings `w-full` back to the section's width, and the matching
  // scroll padding keeps snapping and scrollIntoView centring on the section
  // rather than on the wider scrollport — the two bleeds need not be equal.
  const bleedStyle: CSSProperties = {
    marginLeft: -bleed.left,
    marginRight: -bleed.right,
    paddingLeft: bleed.left,
    paddingRight: bleed.right,
    scrollPaddingLeft: bleed.left,
    scrollPaddingRight: bleed.right,
  };
  return (
    <div
      ref={trackRef}
      onScroll={onScroll}
      style={bleedStyle}
      className={cn(
        "relative flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        SLIDE_GAP,
      )}
    >
      {groups.map((group, index) => {
        const focused = index === active;
        return (
          <div
            key={group.projectId}
            role="group"
            aria-label={group.name}
            onClick={focused ? undefined : () => onSelect(index)}
            className={cn(
              "w-full shrink-0 snap-center transition-opacity duration-200",
              focused ? "opacity-100" : "cursor-pointer opacity-40 hover:opacity-70",
            )}
          >
            <ul
              inert={!focused}
              className={cn("flex flex-col", !focused && "pointer-events-none")}
            >
              {group.threads.map((thread) => renderRow(thread, focused))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** One choice of a `ChoiceMenu`; `itemLabel` words it in the menu when the trigger's short label is not enough. */
interface MenuOption<Key extends string> {
  key: Key;
  label: string;
  itemLabel?: string;
}

/**
 * A one-of-several picker: the trigger names the current choice, the menu ticks it.
 *
 * With an `icon` the trigger is that glyph alone — the words move into the
 * name a screen reader reads and the tooltip a pointer gets, both of which
 * still say which choice is current, so nothing but the width is lost.
 */
function ChoiceMenu<Key extends string>({
  options,
  value,
  title,
  icon,
  onSelect,
}: {
  options: readonly MenuOption<Key>[];
  value: Key;
  title: string;
  icon?: IconName;
  onSelect: (key: Key) => void;
}) {
  const current = options.find((option) => option.key === value) ?? options[0]!;
  // One wording for the icon trigger: a screen reader hears it as the button's
  // name, a pointer reads it in the tooltip, and the two cannot drift apart.
  const name = `${title}: ${current.label}`;
  const trigger =
    icon === undefined ? (
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          {current.label}
          <Icon name="ChevronDown" className="size-3.5 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
    ) : (
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={name}
            >
              <Icon name={icon} className="size-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{name}</TooltipContent>
      </Tooltip>
    );
  return (
    <DropdownMenu>
      {trigger}
      <DropdownMenuContent align="end" mobileTitle={title}>
        {options.map(({ key, label, itemLabel }) => (
          <DropdownMenuItem
            key={key}
            role="menuitemradio"
            aria-checked={key === value}
            onSelect={() => onSelect(key)}
          >
            {itemLabel ?? label}
            {/* Hidden rather than absent, so the menu keeps one width whichever choice is ticked. */}
            <Icon
              name="Check"
              className={cn("ml-auto", key !== value && "invisible")}
              aria-hidden
            />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Opens threads in one side panel rather than a new one per click. The thread
 * last opened there is remembered; while a pane still holds it, that pane is
 * focused and the next thread replaces it (see `sidePaneSteps`). Once the user
 * closes it, the next click splits a side panel off again.
 */
function useSidePane(): { open: (threadId: string) => void; current: string | null } {
  const threadActions = experimental_useSidebarThreadActions();
  const [previous, setPrevious] = useState<string | null>(null);
  // An unknown id reports no layout, so the empty id stands for "nothing opened yet".
  const { layout } = experimental_useSidebarThreadSplit(previous ?? "");

  const open = (threadId: string) => {
    const steps = sidePaneSteps(
      threadId,
      previous === null ? null : { threadId: previous, open: layout !== null },
    );
    for (const step of steps) {
      threadActions.open(step.threadId, step.split ? { split: true } : undefined);
    }
    setPrevious(threadId);
  };
  return { open, current: previous };
}

// bb marks its composer shell; the editable box inside it is the prompt itself.
const COMPOSER_EDITOR_SELECTOR = '[data-app-composer] [contenteditable="true"]';
const QUEUE_ROW_SELECTOR = "[data-queue-row]";
const SIDEBAR_THREAD_ROW_SELECTOR = "[data-sidebar-thread-id]";

/** Whether the caret sits collapsed at the very start of `editor`'s text. */
function caretAtStart(editor: HTMLElement): boolean {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0 || !selection.isCollapsed) return false;
  const caret = selection.getRangeAt(0);
  if (!editor.contains(caret.startContainer)) return false;
  const before = document.createRange();
  before.selectNodeContents(editor);
  before.setEnd(caret.startContainer, caret.startOffset);
  return before.toString() === "";
}

/**
 * The prompt of the page the section sits on. A split window holds a thread's
 * composer in the next pane, marked just like the home screen's, so the search
 * climbs from the section and stops at the first box that holds any composer.
 */
function ownComposerEditor(section: HTMLElement): HTMLElement | null {
  for (let node = section.parentElement; node !== null; node = node.parentElement) {
    const editor = node.querySelector<HTMLElement>(COMPOSER_EDITOR_SELECTOR);
    if (editor !== null) return editor;
  }
  return null;
}

/** The row targets a key can reach: the list on screen, not the rows of a dimmed group. */
function reachableRows(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(QUEUE_ROW_SELECTOR)).filter(
    (row) => row.closest("[inert]") === null,
  );
}

/**
 * The queue by keyboard. The composer is the host's and its hooks do not reach
 * a homepage section, so the ways in are a document listener — see
 * `composerKeyMove`: the down arrow in the home screen's empty composer moves
 * real focus to the first row, the left arrow at the start of the side panel's
 * composer to the row of the thread it shows. From there the section's own
 * handler walks the rows — see `queueKeyMove` — and hands focus back to the
 * composer above the first row or on Escape.
 */
function useQueueKeys(
  rootRef: RefObject<HTMLElement | null>,
  sidePaneThreadId: string | null,
  enabled: boolean,
) {
  const sidePaneThread = useRef(sidePaneThreadId);
  sidePaneThread.current = sidePaneThreadId;

  useEffect(() => {
    if (!enabled) return;
    const onComposerKey = (event: KeyboardEvent) => {
      const root = rootRef.current;
      if (event.defaultPrevented || root === null || !(event.target instanceof Element)) return;
      const editor = event.target.closest<HTMLElement>(COMPOSER_EDITOR_SELECTOR);
      if (editor === null) return;
      const move = composerKeyMove({
        key: event.key,
        modified: event.shiftKey || event.altKey || event.ctrlKey || event.metaKey,
        ownComposer: editor === ownComposerEditor(root),
        empty: (editor.textContent ?? "").trim() === "",
        caretAtStart: caretAtStart(editor),
      });
      if (move === "none") return;
      const rows = reachableRows(root);
      // Back from the side panel lands on the row of the thread it shows, while that row is on screen.
      const target =
        (move === "back-to-queue"
          ? rows.find((row) => row.dataset.queueRow === sidePaneThread.current)
          : undefined) ?? rows[0];
      if (target === undefined) return;
      event.preventDefault();
      target.focus();
    };
    document.addEventListener("keydown", onComposerKey);
    return () => document.removeEventListener("keydown", onComposerKey);
  }, [rootRef, enabled]);

  if (!enabled) return undefined;
  return (event: React.KeyboardEvent<HTMLElement>) => {
    const rows = reachableRows(event.currentTarget);
    const index = rows.indexOf(event.target as HTMLElement);
    // Keys on a row's own buttons, or anywhere off the queue, stay theirs.
    if (index === -1) return;
    const move = queueKeyMove(event.key, index, rows.length);
    if (move.kind === "none") return;
    event.preventDefault();
    if (move.kind === "focus") rows[move.index]!.focus();
    else if (move.kind === "open") rows[index]!.click();
    else ownComposerEditor(event.currentTarget)?.focus();
  };
}

/**
 * Keeps the left panel's thread rows opening in the home screen's pane. bb puts
 * a thread pressed there into the focused pane, and opening one beside the home
 * screen focuses that side panel, so every later press would land in it. A pane
 * takes focus on a pointer press inside it, so a press on a left-panel row first
 * presses the section — inside the home screen's pane — and focus comes back.
 */
function useHomePaneForSidebar(rootRef: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onPress = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root === null || !(event.target instanceof Element)) return;
      if (event.target.closest(SIDEBAR_THREAD_ROW_SELECTOR) === null) return;
      const Press = typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
      root.dispatchEvent(new Press("pointerdown", { bubbles: true }));
    };
    document.addEventListener("pointerdown", onPress, true);
    return () => document.removeEventListener("pointerdown", onPress, true);
  }, [rootRef, enabled]);
}

// The host's homepage column is only as tall as its content. For the postponed
// list to sit at the foot of the pane, every box between the page scroller and
// this section has to fill the height: the column (min-h-full), the sections
// container, this section — and the section's root, whose last block then
// takes `mt-auto`. They are the host's boxes, so they are reached the way the
// host's h2 is hidden: by what they contain. bb wraps a slot in a `contents`
// div, which lays out as if absent. Only a flex column is stretched: the
// compact home screen holds the sections in a plain block under a floating
// composer, where a full-height column would only scroll into blank space.
const FILL_PANE_CLASS =
  "flex-1 [div.flex-col:has(>[data-testid=plugin-homepage-sections]_&)]:min-h-full [[data-testid=plugin-homepage-sections]:has(&)]:flex [[data-testid=plugin-homepage-sections]:has(&)]:flex-1 [[data-testid=plugin-homepage-sections]:has(&)]:flex-col [[data-testid=plugin-homepage-sections]>section:has(&)]:flex [[data-testid=plugin-homepage-sections]>section:has(&)]:flex-1 [[data-testid=plugin-homepage-sections]>section:has(&)]:flex-col";

// On the compact home screen bb floats the composer over a scroller that holds
// its Recents list and, under it, the plugin sections, and starts that scroller
// low, just above the composer. The queue takes Recents' place: the list is
// hidden with its spacer, the scroller starts under the top bar (56px, bb's own
// minimum; `!` beats the inline top bb sets), and a column of flex boxes lets
// the section fill it down to the spacer bb keeps under the composer.
const COMPACT_HOME_CLASS =
  "[[data-testid=root-compose-compact-scroll-viewport]:has(&)]:top-14! [[data-testid=root-compose-compact-scroll-viewport]:has(&)]:flex [[data-testid=root-compose-compact-scroll-viewport]:has(&)]:flex-col [[data-testid=root-compose-compact-scroll-viewport]:has(&)_[data-root-compose-mobile-recents]]:hidden [[data-testid=root-compose-compact-scroll-viewport]:has(&)>[data-testid=root-compose-compact-recents-offset]]:hidden [[data-testid=root-compose-compact-scroll-viewport]>div:has(&)]:flex [[data-testid=root-compose-compact-scroll-viewport]>div:has(&)]:flex-1 [[data-testid=root-compose-compact-scroll-viewport]>div:has(&)]:flex-col [[data-testid=root-compose-compact-scroll-viewport]:has(&)>div:last-child]:shrink-0";

function AttentionSection() {
  const { status, threads, projects } = experimental_useSidebarThreads();
  const navigate = useBbNavigate();
  const threadActions = experimental_useSidebarThreadActions();
  const { postponedIds, setPostponed } = usePostpone();
  const providerOf = useProviderLookup();
  const settings = useSettings();
  const touch = useMediaQuery(TOUCH_QUERY);
  // A touch screen has no hover: a preview there only flickers up on a tap.
  const previewDelayMs = touch ? 0 : parsePreviewDelayMs(settings.values?.previewDelaySeconds);
  // One swiped row at a time, as in a mail list.
  const [swipedRow, setSwipedRow] = useState<string | null>(null);
  const { sort, grouped, openMode: chosenOpenMode, setSort, setOpenMode, toggleGrouped } =
    useFilters();
  // The side panel, the keyboard and the left panel's press all lean on bb
  // behaviour the SDK does not promise, so they wait behind a setting. Off,
  // a side panel chosen earlier is ignored rather than forgotten.
  const experimental = settings.values?.experimentalSidePanel === true;
  const openMode: OpenMode = experimental ? chosenOpenMode : "full";
  // A split goes through the host's own thread action, which applies the same
  // placement a drag to the right edge does and falls back to plain navigation
  // where splits are off; `useSidePane` keeps later threads in that one panel.
  const sidePane = useSidePane();
  const openThread = (threadId: string) =>
    openMode === "split" ? sidePane.open(threadId) : navigate.toThread(threadId);
  const rootRef = useRef<HTMLDivElement>(null);
  const onQueueKeyDown = useQueueKeys(rootRef, sidePane.current, experimental);
  useHomePaneForSidebar(rootRef, experimental && openMode === "split");
  const [showPostponed, setShowPostponed] = useState(false);

  const projectName = useMemo(() => {
    const names = new Map(projects.map((project) => [project.id, project.name]));
    return (id: string) => names.get(id) ?? "—";
  }, [projects]);

  const threadById = useMemo(
    () => new Map(threads.map((thread) => [thread.id, thread])),
    [threads],
  );

  const queue = useMemo(
    () => attentionQueue(threads.map(toFacts), postponedIds, sort),
    [threads, postponedIds, sort],
  );

  const groups = useMemo(
    () => (grouped ? groupByProject(queue, projectName) : []),
    [grouped, queue, projectName],
  );

  const groupTrack = useGroupTrack(groups.length);

  const postponedThreads = useMemo(
    () =>
      [...postponedIds]
        .map((id) => threadById.get(id))
        .filter((thread): thread is PluginSidebarThread => thread !== undefined),
    [postponedIds, threadById],
  );

  const now = Date.now();

  const row = (thread: ThreadFacts, projectLabel: string | null, previewMs: number) => {
    // The queue is built from these same sidebar threads, so the lookup hits.
    const sidebarThread = threadById.get(thread.id)!;
    return (
      <ThreadRow
        key={thread.id}
        thread={thread}
        title={threadTitle(sidebarThread)}
        projectLabel={projectLabel}
        worktree={worktreeOf(sidebarThread.environment)}
        provider={providerOf(sidebarThread.providerId)}
        now={now}
        previewDelayMs={previewMs}
        touch={touch}
        swipeOpen={swipedRow === thread.id}
        onSwipeOpenChange={(open) =>
          setSwipedRow((current) => (open ? thread.id : current === thread.id ? null : current))
        }
        onOpen={() => openThread(thread.id)}
        onPostpone={() => void setPostponed(thread.id, true)}
        onArchive={() => threadActions.archive(thread.id)}
      />
    );
  };
  const flatRow = (thread: ThreadFacts) =>
    row(thread, projectName(thread.projectId), previewDelayMs);
  // Inside a group the slide already names the project, so the row does not;
  // a dimmed slide's rows are out of reach, so they open no preview either.
  const groupedRow = (thread: ThreadFacts, focused: boolean) =>
    row(thread, null, focused ? previewDelayMs : 0);

  if (status === "loading") {
    return <p className="text-sm text-muted-foreground">Загрузка…</p>;
  }
  if (status === "error") {
    return <p className="text-sm text-destructive">Не удалось загрузить треды.</p>;
  }

  return (
    <TooltipProvider delayDuration={300}>
      {/* The host titles every homepage section with an h2 of its own and allows no
          blank title; the heading lives in the filter row instead, so the host's is hidden. */}
      <div
        ref={rootRef}
        onKeyDown={onQueueKeyDown}
        className={cn(
          "flex flex-col gap-3 [[data-testid=plugin-homepage-sections]>section:has(&)>h2]:hidden",
          FILL_PANE_CLASS,
          COMPACT_HOME_CLASS,
        )}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h2 className="shrink-0 text-sm font-semibold text-foreground">
            {SECTION_TITLE}: {queue.length}
          </h2>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <ChoiceMenu
              options={SORTS}
              value={sort}
              title="Сортировка"
              icon="Sort"
              onSelect={setSort}
            />
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={grouped}
              onClick={toggleGrouped}
            >
              По проекту
            </Button>
            {experimental && (
              <>
                <span className="mx-1 h-4 w-px bg-border" aria-hidden />
                <ChoiceMenu
                  options={OPEN_MODES}
                  value={openMode}
                  title="Где открывать тред"
                  onSelect={setOpenMode}
                />
              </>
            )}
          </div>
        </div>

        {grouped && groups.length > 0 && (
          <GroupPills
            groups={groups}
            active={groupTrack.active}
            onSelect={groupTrack.goTo}
          />
        )}

        {queue.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Все треды разобраны. Здесь появятся те, в которых не идёт работа.
          </p>
        ) : grouped ? (
          <GroupedQueue
            groups={groups}
            active={groupTrack.active}
            bleed={groupTrack.bleed}
            trackRef={groupTrack.trackRef}
            onScroll={groupTrack.syncActive}
            onSelect={groupTrack.goTo}
            renderRow={groupedRow}
          />
        ) : (
          <ul className="flex flex-col">
            {queue.map(flatRow)}
          </ul>
        )}

        {postponedThreads.length > 0 && (
          <div className="mt-auto flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setShowPostponed((open) => !open)}
              className="flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
            >
              <Icon
                name={showPostponed ? "ChevronDown" : "ChevronRight"}
                className="size-3.5"
                aria-hidden
              />
              Отложено: {postponedThreads.length}
            </button>
            {showPostponed && (
              <ul className="flex flex-col">
                {postponedThreads.map((thread) => (
                  <PostponedRow
                    key={thread.id}
                    thread={thread}
                    title={threadTitle(thread)}
                    projectLabel={projectName(thread.projectId)}
                    provider={providerOf(thread.providerId)}
                    previewDelayMs={previewDelayMs}
                    onOpen={() => openThread(thread.id)}
                    onRestore={() => void setPostponed(thread.id, false)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

// Where a finger may not start the gesture: everything one types or edits in.
// A swipe up a long draft scrolls the draft, and taking the screen away
// mid-sentence is the one thing the gesture must never do.
const EDITABLE_SELECTOR = "input, textarea, [contenteditable='true'], [contenteditable='']";

/**
 * Whether something under the finger is a list with content still below the
 * fold. A push up over such a list is a request to scroll it, and the gesture
 * keeps out — see `hasRoomBelow`. A conversation resting at its newest message
 * has nothing left to give and lets the gesture through.
 */
function scrollsUnder(from: Element): boolean {
  for (let node: Element | null = from; node !== null; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll" || overflow === "overlay") && hasRoomBelow(node)) {
      return true;
    }
  }
  return false;
}

/**
 * The way out of a thread on a phone: a finger put down at the bottom edge and
 * pushed up takes the screen home, the way the phone itself sends an app away.
 * The rule is `startsHomeSwipe` and `reachesHome`; this is the ear for it.
 *
 * It lives in an app overlay because that is bb's one mount that outlives the
 * route: the section is on the home screen only, and the gesture is needed
 * exactly where the section is not. The overlay draws nothing — it listens on
 * the way down, so a page that stops touches of its own is still heard, and
 * only ever acts on a thread screen under a finger.
 */
function HomeSwipe() {
  const { threadId } = useBbContext();
  const navigate = useBbNavigate();
  const touch = useMediaQuery(TOUCH_QUERY);
  // Read at the moment of the gesture, not at the moment of subscribing: the
  // overlay outlives every route change, and resubscribing on each one would
  // drop a gesture already under way.
  const current = useRef({ threadId, navigate });
  useEffect(() => {
    current.current = { threadId, navigate };
  });

  useEffect(() => {
    if (!touch) return;
    let start: Point | null = null;
    const forget = () => {
      start = null;
    };
    const onStart = (event: TouchEvent) => {
      forget();
      const finger = event.touches.length === 1 ? event.touches[0] : undefined;
      if (finger === undefined || current.current.threadId === null) return;
      if (!(event.target instanceof Element)) return;
      // Cheapest question first: every touch on the screen passes here, and
      // only the few that land on the strip are worth walking the DOM for.
      const point = { x: finger.clientX, y: finger.clientY };
      if (!startsHomeSwipe(point, window.innerHeight)) return;
      if (event.target.closest(EDITABLE_SELECTOR) !== null) return;
      if (scrollsUnder(event.target)) return;
      start = point;
    };
    const onMove = (event: TouchEvent) => {
      const from = start;
      const finger = event.touches[0];
      if (from === null || finger === undefined) return;
      // A move the browser will no longer let anyone stop is a scroll already
      // under way: it started before the finger reached us, and it is not ours.
      if (!event.cancelable) {
        forget();
        return;
      }
      if (!reachesHome(from, { x: finger.clientX, y: finger.clientY })) return;
      forget();
      current.current.navigate.toCompose();
    };
    document.addEventListener("touchstart", onStart, true);
    document.addEventListener("touchmove", onMove, true);
    document.addEventListener("touchend", forget, true);
    document.addEventListener("touchcancel", forget, true);
    return () => {
      document.removeEventListener("touchstart", onStart, true);
      document.removeEventListener("touchmove", onMove, true);
      document.removeEventListener("touchend", forget, true);
      document.removeEventListener("touchcancel", forget, true);
    };
  }, [touch]);

  return null;
}

export default definePluginApp((app) => {
  app.slots.homepageSection({
    id: "needs-attention",
    title: SECTION_TITLE,
    component: AttentionSection,
  });
  // Feature-detected: an older bb without app overlays keeps everything else.
  if (typeof app.slots.experimental_appOverlay === "function") {
    app.slots.experimental_appOverlay({ id: "home-swipe", component: HomeSwipe });
  }
  app.slots.experimental_threadList({
    id: "thread-preview",
    title: "Треды с превью по наведению",
    description: "Список тредов bb, у каждой строки — беседа, проект, ветка и модель по наведению.",
    component: SidebarWithPreview,
  });
});
