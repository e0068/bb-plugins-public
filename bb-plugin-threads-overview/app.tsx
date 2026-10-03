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
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  ThreadChat,
  definePluginApp,
  experimental_NewThreadComposer as NewThreadComposer,
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
  isWorking,
  runsBackgroundCommand,
  nearestSlideIndex,
  revealScrollLeft,
  UNLISTED_NAME,
  type ProjectGroup,
  type SortKey,
  type Span,
  type ThreadFacts,
} from "./src/core/attention";
import { formatWaitingSince } from "./src/core/format";
import { composerKeyMove, queueKeyMove } from "./src/core/keys";
import { sidePaneSteps } from "./src/core/open";
import {
  claimsMove,
  composerBox,
  hasRoomBelow,
  sectionAboveComposer,
  startsHomeSwipe,
  swipeCard,
  type ComposerBox,
  type Point,
  type SwipeCard,
} from "./src/core/home-swipe";
import type { Box } from "./src/core/box";
import {
  createHomeLayer,
  handOverHome,
  hideHome,
  homeComposer,
  mountHomeLayer,
  revealHome,
} from "./home-layer";
import { openRowIntoThread } from "./thread-open";
import { findComposer, foldByDrag, mountFoldStyle, soleFinger, standsOpen } from "./composer-fold";
import { holdSticky, type Hold } from "./sticky-hold";
import { ADOPT_ROW_SWIPE, watchEdgeSwipes, type RowAdoption } from "./edge-swipe";
import {
  ComposerProjectWatch,
  useChooseComposerProject,
  useComposerProject,
  type SlideArrival,
} from "./composer-project";
import {
  claimsRowSwipe,
  holdsGesture,
  startsRowSwipe,
  swipeAxis,
  swipeOffset,
  swipeSettlesOpen,
  type SwipeAxis,
} from "./src/core/swipe";
import { describeFooter, type ExecutionFacts, type GitFacts } from "./src/core/details";
import { parsePreviewDelayMs } from "./src/core/preview";
import { parsePreviewSize } from "./src/core/preview-size";
import { queueLayout, type QueueLayout } from "./src/core/queue-layout";
import { scrolledToEnd } from "./src/core/scroll-end";
import { rowStatus, showsWaitingTime, worktreeOf, type RowStatus, type Worktree } from "./src/core/status";
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
import { useIsCompactViewport } from "@/components/ui/hooks/use-compact-viewport";
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

const SECTION_TITLE = "Threads";

const SORT_LABELS: Record<SortKey, string> = {
  "waiting-longest": "Дольше ждут",
  "waiting-newest": "Свежие",
};

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
  /** Running threads join the queue; off keeps it to the threads that wait for you. */
  showWorking: boolean;
  openMode: OpenMode;
}

const DEFAULT_FILTERS: Filters = {
  sort: "waiting-longest",
  grouped: false,
  showWorking: false,
  openMode: "full",
};

const OPPOSITE_SORT: Record<SortKey, SortKey> = {
  "waiting-longest": "waiting-newest",
  "waiting-newest": "waiting-longest",
};

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
      showWorking:
        typeof parsed.showWorking === "boolean" ? parsed.showWorking : DEFAULT_FILTERS.showWorking,
      openMode: isOpenMode(parsed.openMode) ? parsed.openMode : DEFAULT_FILTERS.openMode,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

/** Which sort, grouping, running-thread choice and open mode the user left the queue in, kept across reloads. */
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
    showWorking: filters.showWorking,
    openMode: filters.openMode,
    toggleSort: useCallback(
      () => persist({ ...filters, sort: OPPOSITE_SORT[filters.sort] }),
      [filters, persist],
    ),
    toggleWorking: useCallback(
      () => persist({ ...filters, showWorking: !filters.showWorking }),
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

/**
 * How a row action looks: a quiet icon beside the row with a mouse, and in the
 * swipe tray of a touch screen a 40 px square on a fill of its own — grey, or
 * red for the one that takes the thread off the list for good.
 */
type RowActionLook = "inline" | "tray" | "tray-destructive";

const ROW_ACTION_LOOKS: Record<RowActionLook, { variant: "ghost" | "secondary" | "destructive"; className: string; icon: string }> = {
  inline: { variant: "ghost", className: "size-7", icon: "size-3.5" },
  tray: { variant: "secondary", className: "size-10 rounded-md", icon: "size-4" },
  "tray-destructive": { variant: "destructive", className: "size-10 rounded-md", icon: "size-4" },
};

/** A row action with no label of its own: the tooltip carries the words. */
function RowAction({
  icon,
  label,
  hint,
  look,
  onClick,
}: {
  icon: IconName;
  label: string;
  hint: string;
  look: RowActionLook;
  onClick: () => void;
}) {
  const { variant, className, icon: iconClass } = ROW_ACTION_LOOKS[look];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size="icon"
          aria-label={label}
          className={cn("shrink-0", className, ABOVE_ROW_TARGET)}
          onClick={onClick}
        >
          <Icon name={icon} className={iconClass} aria-hidden />
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
    projectName: projects.find((project) => project.id === thread.projectId)?.name ?? UNLISTED_NAME,
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

// The same glyphs bb's own sidebar paints for these indicators, except the
// background command: bb spins for it too, but no agent is at work there.
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
  working: {
    label: "Работает",
    hint: "Агент сейчас работает",
    glyph: <Icon name="Loading" className="size-4 animate-spin text-muted-foreground" aria-hidden />,
  },
  "background-command": {
    label: "Запущен фоновый процесс",
    hint: "Запущен фоновый процесс, например сервер; агент не работает",
    glyph: <Icon name="Terminal" className="size-4 text-muted-foreground/75" aria-hidden />,
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
  const status = rowStatus({
    ...thread,
    working: isWorking(thread),
    backgroundCommand: runsBackgroundCommand(thread),
  });
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
  // A working thread's spinner already says it is active now — see `showsWaitingTime`.
  const waiting = showsWaitingTime(status) && (
    <span className="px-1 text-xs text-muted-foreground">
      {formatWaitingSince(now, thread.latestAttentionAt)}
    </span>
  );
  const postpone = (
    <RowAction
      icon="Clock"
      label="Отложить"
      hint="Отложить — убрать из списка, пока в треде не возобновится работа"
      look={touch ? "tray" : "inline"}
      onClick={onPostpone}
    />
  );
  // A status means the thread still holds something for you or runs a process
  // archiving would cut short, so it is not ready to archive.
  const archive = status === null && (
    <RowAction
      icon="Archive"
      label="Архивировать"
      hint="Архивировать тред вместе с дочерними"
      look={touch ? "tray-destructive" : "inline"}
      onClick={onArchive}
    />
  );

  if (touch) {
    return (
      // The mark is what a touch elsewhere on the screen is measured against:
      // inside this row the row decides, outside it the actions go away.
      <li
        className={cn(ROW_SHELL_CLASS, "overflow-hidden")}
        data-swipe-open={swipeOpen ? "" : undefined}
      >
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

// Until the tray is laid out — its first frame, or a DOM with no layout — it is
// taken as two 40 px buttons wide, with the gap between them and the padding.
const SWIPE_TRAY_FALLBACK_WIDTH = 96;

// The open row, as the page sees it: the one shell a finger may land in without
// putting the actions away.
const OPEN_ROW_SELECTOR = "[data-swipe-open]";

/**
 * Puts a swiped row away on the first touch that lands outside it, the way a
 * mail list does. That touch is spent on closing and goes no further: a finger
 * aimed beside the two narrow buttons must not open somebody else's thread. A
 * scroll puts the row away too — an open row must not sail off the screen still
 * open, to be found open on the way back.
 *
 * The ear stays on the document instead of being hung only while a row is open:
 * such a listener would leave in the same breath as the closing touch, and the
 * click that follows that touch — it arrives later — would find nobody left to
 * swallow it. So the open row is read at the moment of the touch.
 */
function useCloseRowOnTouchOutside(openRow: string | null, close: () => void): void {
  const current = useRef(openRow);
  useEffect(() => {
    current.current = openRow;
  });

  useEffect(() => {
    // Set afresh by every touch, so a drag that never becomes a click cannot
    // leave a swallow waiting for someone else's.
    let swallowClick = false;
    const outside = (target: EventTarget | null) =>
      !(target instanceof Element) || target.closest(OPEN_ROW_SELECTOR) === null;
    const onPointerDown = (event: PointerEvent) => {
      swallowClick = current.current !== null && outside(event.target);
      if (swallowClick) close();
    };
    const onClick = (event: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const onScroll = () => {
      if (current.current !== null) close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [close]);
}

/**
 * A row on a touch screen: its actions wait in a tray under the right edge and
 * come out when the row is swiped from right to left, starting on the strip
 * along the right edge of the screen — see `startsRowSwipe`, `swipeAxis`,
 * `swipeOffset` and `swipeSettlesOpen`. A swipe started left of that strip is
 * the project slides' to turn, over the row too, and an upright drag stays the
 * page's scroll. An open row takes a swipe from anywhere on it, so a swipe to
 * the right closes it. The drag's own click is swallowed, and a tap on an open
 * row closes it rather than opening the thread.
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
  const drag = useRef<{ start: Point; now: Point; axis: SwipeAxis; dx: number } | null>(null);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });
  const swallowClick = useRef(false);
  const [dragDx, setDragDx] = useState<number | null>(null);
  const trayWidth = () => trayRef.current?.offsetWidth || SWIPE_TRAY_FALLBACK_WIDTH;
  const offset = dragDx === null ? (open ? -trayWidth() : 0) : swipeOffset(open, dragDx, trayWidth());

  // A swipe the row has taken is the row's, not the page's: not the page's
  // scroll, and not the slides' either — see `claimsRowSwipe`, which answers
  // from the first pixel, before the axis is decided, since iOS hands the
  // whole touch to a scroll the moment it sees one move nobody stopped. Once
  // the axis is sideways the row keeps every move, the finger drifting down
  // over a row's height included — see `holdsGesture` — or the browser would
  // start scrolling and cancel the pointer, snapping the row back mid-swipe.
  // It has to be a listener of our own, since React's is passive and cannot
  // stop anything. It rests on the pointer event coming first: the
  // compatibility rules of Pointer Events put `pointermove` before the
  // `touchmove` of the same finger, so the drag here is already up to date.
  //
  // A swipe from the right edge that landed beside the row, not on it, is
  // handed over by `watchEdgeSwipes`: the row takes the pointer as if the
  // finger had landed on it, and answers whether a move is its own, since the
  // page's moves then go to wherever the finger landed, not to the row.
  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    const keepsMove = () => {
      const current = drag.current;
      if (current === null) return false;
      return current.axis === "undecided"
        ? claimsRowSwipe(current.start, current.now, openRef.current)
        : holdsGesture(current.axis, true);
    };
    const hold = (event: TouchEvent) => {
      if (event.cancelable && keepsMove()) event.preventDefault();
    };
    const adopt = (event: Event) => {
      const adoption = (event as CustomEvent<RowAdoption>).detail;
      swallowClick.current = false;
      drag.current = { start: adoption.start, now: adoption.start, axis: "undecided", dx: 0 };
      try {
        panel.setPointerCapture?.(adoption.pointerId);
      } catch {
        // The finger is already gone: there is nothing left to swipe.
        drag.current = null;
        return;
      }
      adoption.holds = keepsMove;
    };
    panel.addEventListener("touchmove", hold, { passive: false });
    panel.addEventListener(ADOPT_ROW_SWIPE, adopt);
    return () => {
      panel.removeEventListener("touchmove", hold);
      panel.removeEventListener(ADOPT_ROW_SWIPE, adopt);
    };
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") return;
    swallowClick.current = false;
    drag.current = null;
    // A closed row takes only a finger put down on the right-edge strip; the
    // rest go to the slides and the page.
    if (!open && !startsRowSwipe(event.clientX, window.innerWidth)) return;
    const start = { x: event.clientX, y: event.clientY };
    drag.current = { start, now: start, axis: "undecided", dx: 0 };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current === null) return;
    current.now = { x: event.clientX, y: event.clientY };
    const dx = current.now.x - current.start.x;
    if (current.axis === "undecided") {
      current.axis = swipeAxis(dx, current.now.y - current.start.y);
      if (current.axis === "undecided") return;
      // Upright, or sideways the way a closed row has nothing to open: the
      // page's or the slides' for good.
      if (current.axis === "vertical" || !claimsRowSwipe(current.start, current.now, open)) {
        drag.current = null;
        return;
      }
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
          // At least 44 px, so the tray's 40 px squares fit the row with room around them.
          "relative z-10 min-h-11 bg-background",
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
 *
 * The track opens on slide `openAt` whenever it appears. `onChoose` hears the
 * slides the user picks — a pill, a click, a swipe — and nothing else: not the
 * slide the track opens on, not a slide a group coming or going moves under
 * the viewport, not the slides a smooth scroll to a picked one passes, and
 * not the slides a swipe crosses — only the one it comes to rest on.
 */
function useGroupTrack(
  groupCount: number,
  openAt: number,
  onChoose: (index: number, arrival: SlideArrival) => void,
) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  // The slide the track last came to rest on: a swipe hands on only a new one.
  const settled = useRef(0);
  const bleed = useTrackBleed(trackRef, groupCount > 0);
  // The slide a pick is scrolling to; the slides passed on the way are not picked.
  const target = useRef<number | null>(null);
  // Set while the track has just opened on a slide the geometry has not caught up with.
  const opening = useRef(false);
  const chooseRef = useRef(onChoose);
  useEffect(() => {
    chooseRef.current = onChoose;
  });

  const readActive = useCallback((): number | null => {
    const track = trackRef.current;
    if (track === null) return null;
    const centers = Array.from(track.children).map((slide) => {
      const element = slide as HTMLElement;
      return element.offsetLeft + element.offsetWidth / 2;
    });
    // The bleed is scrollport the section does not own: the section's centre
    // sits midway between the two bleeds, not midway across the scrollport.
    const sectionWidth = track.clientWidth - bleed.left - bleed.right;
    return nearestSlideIndex(centers, track.scrollLeft + bleed.left + sectionWidth / 2);
  }, [bleed]);

  const syncActive = useCallback(() => {
    if (opening.current) {
      opening.current = false;
      return;
    }
    const index = readActive();
    if (index === null) return;
    settled.current = index;
    setActive(index);
  }, [readActive]);

  // Open on the slide asked for the moment the track appears, before the
  // first paint, so it never flashes on slide 0 on its way there.
  const shown = groupCount > 0;
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!shown || track === null) return;
    const index = Math.min(Math.max(openAt, 0), groupCount - 1);
    const slide = track.children[index] as HTMLElement | undefined;
    if (slide !== undefined) track.scrollLeft = slide.offsetLeft - bleed.left;
    settled.current = index;
    setActive(index);
    opening.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only as the track appears
  }, [shown]);

  // A group can vanish while it is the focused one (its last thread was dealt
  // with), which leaves the track scrolled somewhere new without a scroll event.
  useEffect(syncActive, [syncActive, groupCount]);

  // A swipe hands its slide on only once it comes to rest: handing it on is a
  // navigation that redraws Home, and doing it at every slide the swipe
  // crossed jerked the page and threw the track off mid-swipe.
  const pause = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(pause.current), []);

  const onScrollEnd = useCallback(() => {
    clearTimeout(pause.current);
    if (target.current !== null) return;
    const index = readActive();
    if (index === null || index === settled.current) return;
    settled.current = index;
    chooseRef.current(index, "scrolled");
  }, [readActive]);

  // A pick keeps the focus on its slide all the way there: lighting up each
  // slide it scrolls past made the pills and the slides flicker.
  const onScroll = useCallback(() => {
    const index = readActive();
    if (index === null) return;
    if (target.current !== null) {
      if (index === target.current) target.current = null;
      return;
    }
    setActive(index);
    // A browser without scrollend gets a pause in the scrolling for the rest.
    if (trackRef.current !== null && !("onscrollend" in trackRef.current)) {
      clearTimeout(pause.current);
      pause.current = setTimeout(onScrollEnd, SCROLL_REST_MS);
    }
  }, [readActive, onScrollEnd]);

  // A finger or a pointer on the track takes over from a pick still
  // scrolling, and the focus follows the scroll again.
  const onTakeOver = useCallback(() => {
    target.current = null;
  }, []);

  // So does a sideways wheel; one that only scrolls the page leaves the pick going.
  const onWheel = useCallback((event: React.WheelEvent) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || event.shiftKey) target.current = null;
  }, []);

  // Focus a slide the track is about to scroll to. One already in view
  // scrolls nowhere and hears no scroll event to end on, so it sets no target
  // that would hold the focus.
  const aimAt = useCallback((index: number) => {
    target.current = readActive() === index ? null : index;
    settled.current = index;
    setActive(index);
  }, [readActive]);

  const goTo = useCallback((index: number) => {
    aimAt(index);
    chooseRef.current(index, "picked");
    trackRef.current?.children[index]?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [aimAt]);

  // A slide chosen outside the track — the composer went to its project — is
  // shown, not handed on. The track alone scrolls: `scrollIntoView` would
  // move bb's page too, under a user who did not touch it.
  const show = useCallback((index: number) => {
    const slide = trackRef.current?.children[index] as HTMLElement | undefined;
    if (index === settled.current || slide === undefined) return;
    aimAt(index);
    trackRef.current?.scrollTo({ left: slide.offsetLeft - bleed.left, behavior: "smooth" });
  }, [aimAt, bleed]);

  return { trackRef, active, bleed, goTo, show, onScroll, onScrollEnd, onTakeOver, onWheel };
}

// How long the track has to stand still to count as at rest where the browser has no scrollend, in ms.
const SCROLL_REST_MS = 150;

// The section's root, as the page and bb's own boxes find it.
const SECTION_SELECTOR = "[data-threads-overview-section]";

/** The nearest ancestor that cuts off whatever overflows it sideways — where the track has to stop. */
function clippingAncestor(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    if (getComputedStyle(node).overflowX !== "visible") return node;
  }
  return null;
}

/**
 * How far the track reaches past the section on each side: out to the edges of
 * whatever clips it — bb's own page scroller, which is as wide as the pane, or,
 * with the queue bottom-up, the section's own scroller that reaches as far — so
 * neighbouring lists run on across the page instead of ending at the composer's
 * width. The section is re-measured whenever it or that box resizes.
 */
function useTrackBleed(
  trackRef: RefObject<HTMLDivElement | null>,
  mounted: boolean,
): Span {
  const [bleed, setBleed] = useState<Span>({ left: 0, right: 0 });

  useEffect(() => {
    const track = trackRef.current;
    const section = track?.closest<HTMLElement>(SECTION_SELECTOR) ?? null;
    if (!mounted || track === null || section === null || typeof ResizeObserver === "undefined") return;
    const clip = clippingAncestor(track);

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

/**
 * The project pills that pick a slide — a row of their own under the section's
 * header. With a mouse they wrap instead of clipping; on a touch screen they
 * keep to one line that scrolls sideways, so they never eat the height the list
 * needs, and the pill of the slide in view is brought along the line into sight.
 */
function GroupPills({
  groups,
  active,
  touch,
  onSelect,
}: {
  groups: readonly ProjectGroup[];
  active: number;
  touch: boolean;
  onSelect: (index: number) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  // The row alone scrolls: `scrollIntoView` would move every scroller around
  // it too, bb's page included, and jump Home to the pills.
  useEffect(() => {
    const row = rowRef.current;
    const pill = row?.children[active];
    if (!touch || row === null || pill === undefined) return;
    const left = revealScrollLeft(row.getBoundingClientRect(), pill.getBoundingClientRect(), row.scrollLeft);
    if (left !== row.scrollLeft) row.scrollTo({ left, behavior: "smooth" });
  }, [touch, active]);
  return (
    <div
      ref={rowRef}
      className={cn(
        "flex items-center gap-1",
        touch
          ? "flex-nowrap overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          : "flex-wrap",
      )}
    >
      {groups.map((group, index) => (
        <Button
          key={group.projectId}
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0"
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
  onScrollEnd,
  onTakeOver,
  onWheel,
  onSelect,
  renderRow,
  layout,
}: {
  groups: readonly ProjectGroup[];
  active: number;
  bleed: Span;
  trackRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onScrollEnd: () => void;
  onTakeOver: () => void;
  onWheel: (event: React.WheelEvent) => void;
  onSelect: (index: number) => void;
  renderRow: (thread: ThreadFacts, focused: boolean) => ReactNode;
  layout: QueueLayout;
}) {
  const classes = QUEUE_LAYOUT[layout];
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
      onScrollEnd={onScrollEnd}
      onPointerDown={onTakeOver}
      onWheel={onWheel}
      style={bleedStyle}
      className={cn(
        "relative flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        SLIDE_GAP,
        classes.track,
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
              className={cn(classes.list, !focused && "pointer-events-none")}
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

const SORT_ICONS: Record<SortKey, IconName> = {
  "waiting-longest": "SortDown",
  "waiting-newest": "SortUp",
};

/**
 * A header control that is one glyph: the words live in the name a screen
 * reader reads and the tooltip a pointer gets, one wording for both so the two
 * cannot drift apart.
 */
function IconToggle({
  name,
  pressed,
  onClick,
  children,
}: {
  name: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative size-8"
          aria-label={name}
          aria-pressed={pressed}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  );
}

/** The queue's order, turned around on a press; the arrow shows which way it runs now. */
function SortToggle({ sort, onToggle }: { sort: SortKey; onToggle: () => void }) {
  return (
    <IconToggle name={`Сортировка: ${SORT_LABELS[sort]}`} onClick={onToggle}>
      <Icon name={SORT_ICONS[sort]} className="size-3.5" aria-hidden />
    </IconToggle>
  );
}

/** Whether running threads join the queue; crossed out while they stay away. */
function WorkingToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <IconToggle
      name={shown ? "Работающие треды: показаны" : "Работающие треды: скрыты"}
      pressed={shown}
      onClick={onToggle}
    >
      <Icon name="Loading" className="size-3.5" aria-hidden />
      {!shown && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-[1.5px] w-[18px] -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full bg-current"
        />
      )}
    </IconToggle>
  );
}

/** A one-of-several picker: the trigger names the current choice, the menu ticks it. */
function ChoiceMenu<Key extends string>({
  options,
  value,
  title,
  onSelect,
}: {
  options: readonly MenuOption<Key>[];
  value: Key;
  title: string;
  onSelect: (key: Key) => void;
}) {
  const current = options.find((option) => option.key === value) ?? options[0]!;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          {current.label}
          <Icon name="ChevronDown" className="size-3.5 text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
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

/** bb's compact Home scroller, which carries the queue under a fade over its composer. */
const COMPACT_SCROLLER_SELECTOR = "[data-testid=root-compose-compact-scroll-viewport]";

// bb fades the rows passing under the composer of its compact Home and lifts
// the fade only when there is nothing to scroll. Scrolled to its foot, the
// queue's last row stands right above the composer, under the fade: the section
// marks itself there (`data-scroll-end`) and the fade goes — see `useCompactHomeAtEnd`.
const FADE_AT_END_CLASS =
  "[[data-testid=root-compose-compact-home]:has(&)_[data-testid=root-compose-compact-fade]]:transition-opacity [[data-testid=root-compose-compact-home]:has(&[data-scroll-end])_[data-testid=root-compose-compact-fade]]:opacity-0";

/**
 * Whether bb's compact Home around `root` is scrolled to its foot. Measured at
 * every scroll of that scroller — heard on the document, since a scroll does
 * not bubble — and whenever the section or the scroller changes size: the
 * queue grows under a still scroller, the composer grows into it. Off the
 * compact Home it never holds.
 */
function useCompactHomeAtEnd(root: HTMLElement | null): boolean {
  const [atEnd, setAtEnd] = useState(false);
  useEffect(() => {
    if (root === null) return;
    const measure = () => {
      const scroller = root.closest<HTMLElement>(COMPACT_SCROLLER_SELECTOR);
      setAtEnd(scroller !== null && scrolledToEnd(scroller));
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Element && event.target.matches(COMPACT_SCROLLER_SELECTOR)) measure();
    };
    measure();
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    resize?.observe(root);
    const scroller = root.closest(COMPACT_SCROLLER_SELECTOR);
    if (scroller !== null) resize?.observe(scroller);
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      resize?.disconnect();
    };
  }, [root]);
  return atEnd;
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

// What the compact Home needs whichever way the queue runs: no gap over the
// sections, the scroller started under the top bar as a flex column, and
// Recents hidden with its spacer — see the two classes below.
const COMPACT_HOME_SHARED_CLASS =
  "[[data-testid=root-compose-compact-scroll-viewport]_[data-testid=plugin-homepage-sections]:has(&)]:mt-0 [[data-testid=root-compose-compact-scroll-viewport]:has(&)]:top-14! [[data-testid=root-compose-compact-scroll-viewport]:has(&)]:flex [[data-testid=root-compose-compact-scroll-viewport]:has(&)]:flex-col [[data-testid=root-compose-compact-scroll-viewport]:has(&)_[data-root-compose-mobile-recents]]:hidden [[data-testid=root-compose-compact-scroll-viewport]:has(&)_[data-testid=root-compose-compact-recents-offset]]:hidden";

// On the compact home screen bb floats the composer over a scroller that holds
// its Recents list and, under it, the plugin sections, and starts that scroller
// low, just above the composer. The queue takes Recents' place: the list is
// hidden with its spacer, the scroller starts under the top bar (56px, bb's own
// minimum; `!` beats the inline top bb sets), and a column of flex boxes lets
// the section fill it down to the spacer bb keeps under the composer. The boxes
// grow from their content, never from a zero basis: since 0.45 bb wraps the
// column in a box held at the scroller's height (`min-h-full`), which then has
// no floor of its content — sized from zero or let shrink, it stays one screen
// tall and the list spills over its top, where nothing scrolls. bb's sections
// box keeps its own 24px top margin, which would open a gap under the top bar
// at the top of the scroller, so it goes too.
const COMPACT_HOME_CLASS = cn(
  COMPACT_HOME_SHARED_CLASS,
  "[[data-testid=root-compose-compact-scroll-viewport]>div:has(&)]:flex [[data-testid=root-compose-compact-scroll-viewport]>div:has(&)]:grow [[data-testid=root-compose-compact-scroll-viewport]>div:has(&)]:shrink-0 [[data-testid=root-compose-compact-scroll-viewport]>div:has(&)]:flex-col [[data-testid=root-compose-compact-scroll-viewport]:has(&)_div:has(>[data-testid=plugin-homepage-sections])]:flex [[data-testid=root-compose-compact-scroll-viewport]:has(&)_div:has(>[data-testid=plugin-homepage-sections])]:grow [[data-testid=root-compose-compact-scroll-viewport]:has(&)_div:has(>[data-testid=plugin-homepage-sections])]:flex-col [[data-testid=root-compose-compact-scroll-viewport]:has(&)>div:last-child]:shrink-0",
);

// The same Home with the queue bottom-up — see `queueLayout`. The section no
// longer hands the scroller its height to scroll: bb's boxes are held at the
// scroller's height instead, each let shrink to it (`min-h-0` beats bb's
// `min-h-full` on specificity), and the threads scroll in a box of the
// section's own. The count, the filters and the pills stand outside that box,
// so they stay put above the composer, and the spacer under it keeps its height.
const COMPACT_HOME_BOTTOM_UP_CLASS = cn(
  COMPACT_HOME_SHARED_CLASS,
  "[[data-testid=root-compose-compact-scroll-viewport]>div:has(&)]:flex [[data-testid=root-compose-compact-scroll-viewport]>div:has(&)]:flex-1 [[data-testid=root-compose-compact-scroll-viewport]>div:has(&)]:min-h-0 [[data-testid=root-compose-compact-scroll-viewport]>div:has(&)]:flex-col [[data-testid=root-compose-compact-scroll-viewport]:has(&)_div:has(>[data-testid=plugin-homepage-sections])]:flex [[data-testid=root-compose-compact-scroll-viewport]:has(&)_div:has(>[data-testid=plugin-homepage-sections])]:flex-1 [[data-testid=root-compose-compact-scroll-viewport]:has(&)_div:has(>[data-testid=plugin-homepage-sections])]:min-h-0 [[data-testid=root-compose-compact-scroll-viewport]:has(&)_div:has(>[data-testid=plugin-homepage-sections])]:flex-col [[data-testid=root-compose-compact-scroll-viewport]_[data-testid=plugin-homepage-sections]:has(&)]:min-h-0 [[data-testid=root-compose-compact-scroll-viewport]_[data-testid=plugin-homepage-sections]>section:has(&)]:min-h-0 [[data-testid=root-compose-compact-scroll-viewport]:has(&)_[data-testid=root-compose-compact-bottom-spacer]]:shrink-0",
);

/**
 * How each part of the section runs in each layout. Bottom-up, every column is
 * turned over: the header, the pills and the threads stack up from the
 * composer, the threads from the first one up, and the postponed ones sit at
 * the far end, opening upwards. The threads' box is a reversed column too, so
 * the browser opens it scrolled to its foot. It reaches out over bb's 16 px
 * side padding and pads itself back in, so the project slides still run out to
 * the edges of the screen. Top-down that box is no box at all (`contents`).
 */
const QUEUE_LAYOUT: Record<
  QueueLayout,
  { root: string; threads: string; list: string; track: string; postponed: string; skeleton: string }
> = {
  "top-down": {
    root: cn("flex-col", COMPACT_HOME_CLASS),
    threads: "contents",
    list: "flex flex-col",
    track: "",
    postponed: "mt-auto flex flex-col",
    skeleton: "flex-col",
  },
  "bottom-up": {
    root: cn("min-h-0 flex-col-reverse [[data-home-swipe-section]_&]:h-full", COMPACT_HOME_BOTTOM_UP_CLASS),
    threads:
      "-mx-4 flex min-h-0 flex-1 flex-col-reverse gap-3 overflow-x-hidden overflow-y-auto overscroll-contain px-4",
    // A row draws the line under itself, and the last one none; turned over,
    // the line goes under every row but the first, which stands on the pills.
    list: "flex flex-col-reverse [&>li:first-child]:border-b-0 [&>li:last-child:not(:first-child)]:border-b",
    track: "shrink-0 items-end",
    postponed: "flex flex-col-reverse",
    skeleton: "h-full flex-col-reverse overflow-hidden",
  },
};

/** Which way the queue runs here — see `queueLayout`. */
function useQueueLayout(): QueueLayout {
  const settings = useSettings();
  return queueLayout(settings.values?.invertOnPhone, useIsCompactViewport());
}

function AttentionSection() {
  const { status, threads, projects } = experimental_useSidebarThreads();
  const navigate = useBbNavigate();
  const threadActions = experimental_useSidebarThreadActions();
  const { postponedIds, setPostponed } = usePostpone();
  const providerOf = useProviderLookup();
  const settings = useSettings();
  const touch = useMediaQuery(TOUCH_QUERY);
  const layout = useQueueLayout();
  const classes = QUEUE_LAYOUT[layout];
  // A touch screen has no hover: a preview there only flickers up on a tap.
  const previewDelayMs = touch ? 0 : parsePreviewDelayMs(settings.values?.previewDelaySeconds);
  // One swiped row at a time, as in a mail list, and a touch outside the open
  // row puts it away — see `useCloseRowOnTouchOutside`.
  const [swipedRow, setSwipedRow] = useState<string | null>(null);
  const closeSwipedRow = useCallback(() => setSwipedRow(null), []);
  useCloseRowOnTouchOutside(swipedRow, closeSwipedRow);
  const {
    sort,
    grouped,
    showWorking,
    openMode: chosenOpenMode,
    toggleSort,
    toggleWorking,
    setOpenMode,
    toggleGrouped,
  } = useFilters();
  // The side panel, the keyboard and the left panel's press all lean on bb
  // behaviour the SDK does not promise, so they wait behind a setting. Off,
  // a side panel chosen earlier is ignored rather than forgotten.
  const experimental = settings.values?.experimentalSidePanel === true;
  const openMode: OpenMode = experimental ? chosenOpenMode : "full";
  // A split goes through the host's own thread action, which applies the same
  // placement a drag to the right edge does and falls back to plain navigation
  // where splits are off; `useSidePane` keeps later threads in that one panel.
  const sidePane = useSidePane();
  // A thread opened from the queue leaves no row open behind it: beside the
  // home screen in a pane it stays in sight, and on the way back from a whole
  // screen of thread the list has to meet you closed. On a phone the row grows
  // into the thread at once, while bb is still loading it — see `thread-open.ts`.
  const openThread = (threadId: string) => {
    closeSwipedRow();
    if (openMode === "split") {
      sidePane.open(threadId);
      return;
    }
    const row = rootRef.current?.querySelector(`[data-queue-row="${threadId}"]`)?.closest("li");
    const thread = threadById.get(threadId);
    if (touch && row && thread) openRowIntoThread(row, threadTitle(thread));
    navigate.toThread(threadId);
  };
  const rootRef = useRef<HTMLDivElement>(null);
  const onQueueKeyDown = useQueueKeys(rootRef, sidePane.current, experimental);
  useHomePaneForSidebar(rootRef, experimental && openMode === "split");
  // The edges of Home are edge gestures' on a touch screen — see `watchEdgeSwipes`.
  // Heard from the section itself, which is on the page only once the threads are in.
  const [rootNode, setRootNode] = useState<HTMLDivElement | null>(null);
  const attachRoot = useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node;
    setRootNode(node);
  }, []);
  useEffect(
    () => (touch && rootNode !== null ? watchEdgeSwipes(rootNode) : undefined),
    [touch, rootNode],
  );
  const atScrollEnd = useCompactHomeAtEnd(rootNode);
  const [showPostponed, setShowPostponed] = useState(false);

  const projectName = useMemo(() => {
    const names = new Map(projects.map((project) => [project.id, project.name]));
    return (id: string) => names.get(id) ?? UNLISTED_NAME;
  }, [projects]);

  const threadById = useMemo(
    () => new Map(threads.map((thread) => [thread.id, thread])),
    [threads],
  );

  const queue = useMemo(
    () => attentionQueue(threads.map(toFacts), postponedIds, sort, showWorking),
    [threads, postponedIds, sort, showWorking],
  );

  const groups = useMemo(
    () => (grouped ? groupByProject(queue, projects) : []),
    [grouped, queue, projects],
  );

  // The slide the user picks goes into the home composer; the track opens on
  // the one picked last time, so coming back to Home changes nothing.
  const composerProject = useComposerProject();
  const chooseComposerProject = useChooseComposerProject(openMode !== "split");
  const groupTrack = useGroupTrack(
    groups.length,
    groups.findIndex((group) => group.projectId === composerProject),
    (index, arrival) => {
      const group = groups[index];
      if (group !== undefined) chooseComposerProject(group.projectId, arrival);
    },
  );
  // The composer can change project without the section — New thread on a
  // project in the sidebar, the composer's own picker — and the slides follow.
  const followed = useRef(composerProject);
  const { show } = groupTrack;
  useEffect(() => {
    if (composerProject === followed.current) return;
    followed.current = composerProject;
    const index = groups.findIndex((group) => group.projectId === composerProject);
    if (index >= 0) show(index);
  }, [composerProject, groups, show]);
  // Switching grouping on is a pick too: of the slide the track will open on.
  const onToggleGrouped = () => {
    if (!grouped) {
      const opening = groupByProject(queue, projects);
      const group = opening.find(({ projectId }) => projectId === composerProject) ?? opening[0];
      if (group !== undefined) chooseComposerProject(group.projectId, "picked");
    }
    toggleGrouped();
  };

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
        ref={attachRoot}
        data-threads-overview-section=""
        data-scroll-end={atScrollEnd ? "" : undefined}
        onKeyDown={onQueueKeyDown}
        className={cn(
          "flex gap-3 [[data-testid=plugin-homepage-sections]>section:has(&)>h2]:hidden",
          FILL_PANE_CLASS,
          FADE_AT_END_CLASS,
          classes.root,
        )}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h2 className="shrink-0 text-sm font-semibold text-foreground">
            {SECTION_TITLE}: {queue.length}
          </h2>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <SortToggle sort={sort} onToggle={toggleSort} />
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            <WorkingToggle shown={showWorking} onToggle={toggleWorking} />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={grouped}
              onClick={onToggleGrouped}
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
            touch={touch}
            onSelect={groupTrack.goTo}
          />
        )}

        <div className={classes.threads}>
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
              onScroll={groupTrack.onScroll}
              onScrollEnd={groupTrack.onScrollEnd}
              onTakeOver={groupTrack.onTakeOver}
              onWheel={groupTrack.onWheel}
              onSelect={groupTrack.goTo}
              renderRow={groupedRow}
              layout={layout}
            />
          ) : (
            <ul className={classes.list}>
              {queue.map(flatRow)}
            </ul>
          )}

          {postponedThreads.length > 0 && (
            <div className={cn("gap-2", classes.postponed)}>
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
                <ul className={classes.list}>
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
      </div>
    </TooltipProvider>
  );
}

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

// bb's own layout root: the whole screen, which the gesture lifts as a card.
const SWIPE_SCREEN_SELECTOR = "[data-testid=app-layout-root]";

// How long a card let go short of home takes to settle back, in ms.
const SWIPE_SETTLE_MS = 200;

/** Lift the screen as `card` says, casting its shadow on Home beneath. */
function carryScreen(screen: HTMLElement, card: SwipeCard): void {
  screen.style.transition = "none";
  screen.style.transformOrigin = "50% 100%";
  screen.style.transform = `translateY(${-card.lift}px) scale(${card.scale})`;
  screen.style.borderRadius = `${card.radius}px`;
  screen.style.overflow = "hidden";
  screen.style.boxShadow = cardShadow(card.shade);
}

/**
 * The shadow of the card, `shade` dark from 0 to 1: blurred round the card
 * only, so Home beneath is in plain view however far the card has gone.
 */
function cardShadow(shade: number): string {
  return `0 16px 48px rgb(0 0 0 / ${shade})`;
}

/** Fill the screen with the page's own background, so the composer laid beneath does not show through it. */
function fillScreen(screen: HTMLElement): void {
  screen.style.backgroundColor = "var(--background)";
}

/** Take the card look off the screen at once. */
function releaseScreen(screen: HTMLElement): void {
  screen.style.transition = "";
  screen.style.transformOrigin = "";
  screen.style.transform = "";
  screen.style.borderRadius = "";
  screen.style.overflow = "";
  screen.style.boxShadow = "";
  screen.style.backgroundColor = "";
}

/**
 * The way out of a thread on a phone: a finger put down at the bottom edge and
 * pushed up lifts the thread screen as a card, the way the phone itself sends
 * an app away. Let go past the reach and the screen goes home; bring the finger
 * back and let go short of it, and the card settles back into the thread. The
 * rules are `startsHomeSwipe` and `swipeCard`; this is the ear and the hand.
 *
 * It lives in an app overlay because that is bb's one mount that outlives the
 * route: the section is on the home screen only, and the gesture is needed
 * exactly where the section is not. The overlay draws nothing — it listens on
 * the way down, so a page that stops touches of its own is still heard, and
 * only ever acts on a thread screen under a finger. The card is bb's own layout
 * root, moved by style; a bb without it keeps the gesture, only unseen. The
 * thread's composer on it is held where it stood — see `sticky-hold.ts`.
 *
 * Beneath the card lies bb's own composer, standing where it stood on Home —
 * see `home-layer.ts` and `HomeComposer`. It is laid out from the moment the
 * overlay mounts, so the lift only moves and shows; nothing is copied. Every
 * touch while Home is on the screen notes where its composer stands, so the
 * touch that leaves Home for a thread leaves the freshest place behind; a
 * thread reached without passing Home stands it at the bottom edge. The rest
 * of Home is bb's to draw once the finger lets go past the reach, and the
 * composer covers the screen until it has.
 *
 * The strip runs unbroken across the bottom, the composer included: the field
 * for typing sits in the middle of it, and a strip a thumb cannot start in is
 * no strip at all. A draft is not lost to the gesture — bb keeps it — so the
 * only thing a swipe over the composer gives up is a draft long enough to
 * scroll, which `scrollsUnder` leaves to the composer as it does to any list.
 */
function HomeSwipe() {
  const { threadId } = useBbContext();
  const inThread = threadId !== null;
  const navigate = useBbNavigate();
  const touch = useMediaQuery(TOUCH_QUERY);
  const [layer] = useState(createHomeLayer);
  const [box, setBox] = useState<ComposerBox | null>(null);
  const [sectionBox, setSectionBox] = useState<Box | null>(null);
  // The list under the card is drawn from the moment the card first lifts
  // until the layer goes back beneath the page — the card settled back into
  // the thread, or the live Home handed the screen over; the rest of the time
  // the section there is a skeleton. A tap on the strip lifts nothing and
  // draws nothing.
  const [live, setLive] = useState(false);
  // Read at the moment of the gesture, not at the moment of subscribing: the
  // overlay outlives every route change, and resubscribing on each one would
  // drop a gesture already under way.
  const current = useRef(navigate);
  useEffect(() => {
    current.current = navigate;
  });
  // Calls off a layer still covering the screen after going home. It outlives
  // the thread it left: the handover runs on Home, where the gesture is gone.
  const handingOver = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!touch) return;
    const unmount = mountHomeLayer(layer);
    return () => {
      handingOver.current?.();
      hideHome(layer);
      unmount();
    };
  }, [touch, layer]);

  // A look, never a hold: every touch notes where Home's composer and the
  // section stand, if Home is on the screen, without keeping anything from the page.
  useEffect(() => {
    if (!touch) return;
    const note = () => {
      const shown = document.querySelector<HTMLElement>(SWIPE_SCREEN_SELECTOR);
      const composer = shown !== null ? homeComposer(shown) : null;
      if (composer !== null) {
        const next = composerBox(composer.getBoundingClientRect(), window.innerHeight);
        setBox((prev) =>
          prev !== null && prev.left === next.left && prev.width === next.width && prev.bottom === next.bottom
            ? prev
            : next,
        );
      }
      const section = shown !== null ? homeSection(shown) : null;
      if (section !== null) {
        const { top, left, width, height } = sectionAboveComposer(
          section.getBoundingClientRect(),
          composer?.getBoundingClientRect().top ?? null,
        );
        setSectionBox((prev) =>
          prev !== null && prev.top === top && prev.left === left && prev.width === width && prev.height === height
            ? prev
            : { top, left, width, height },
        );
      }
    };
    document.addEventListener("touchstart", note, { capture: true, passive: true });
    return () => document.removeEventListener("touchstart", note, true);
  }, [touch]);

  // The gesture listens only while a thread is open. On Home there is nowhere
  // to go, and a page-wide listener that may hold a move makes the browser
  // wait on it before every scroll there.
  useEffect(() => {
    if (!touch || !inThread) return;
    let start: Point | null = null;
    let last: Point | null = null;
    let carried: HTMLElement | null = null;
    // The hold on bb's composer while the card is carried — see `holdSticky`.
    let hold: Hold | null = null;
    // A card easing back into place, and the timer that lays it flat and hides the layer.
    let settling: { card: HTMLElement; timer: number } | null = null;
    const screen = () => document.querySelector<HTMLElement>(SWIPE_SCREEN_SELECTOR);
    const layFlat = (card: HTMLElement) => {
      releaseScreen(card);
      hold?.release();
      hold = null;
    };
    const finishSettling = () => {
      if (settling === null) return;
      window.clearTimeout(settling.timer);
      layFlat(settling.card);
      hideHome(layer);
      setLive(false);
      settling = null;
    };
    // Put a carried screen back: at once when leaving it anyway, or eased into place.
    const settle = (animate: boolean) => {
      finishSettling();
      const card = carried;
      carried = null;
      start = null;
      last = null;
      if (card === null) return;
      if (!animate) {
        layFlat(card);
        return;
      }
      card.style.transition = `transform ${SWIPE_SETTLE_MS}ms ease-out, border-radius ${SWIPE_SETTLE_MS}ms ease-out, box-shadow ${SWIPE_SETTLE_MS}ms ease-out`;
      card.style.transform = "";
      card.style.borderRadius = "";
      card.style.boxShadow = cardShadow(0);
      settling = { card, timer: window.setTimeout(finishSettling, SWIPE_SETTLE_MS) };
    };
    const onStart = (event: TouchEvent) => {
      settle(true);
      const point = soleFinger(event);
      if (point === null || !(event.target instanceof Element)) return;
      // Cheapest question first: every touch on the screen passes here, and
      // only the few that land on the strip are worth walking the DOM for.
      if (!startsHomeSwipe(point, window.innerHeight)) return;
      if (scrollsUnder(event.target)) return;
      // An open composer has the bottom of the screen: a push up there is
      // nobody's — see `holdsOpenComposer` — and never goes home.
      const composer = findComposer();
      if (composer !== null && standsOpen(composer)) return;
      start = point;
    };
    const onMove = (event: TouchEvent) => {
      const from = start;
      const finger = event.touches[0];
      if (from === null || finger === undefined) return;
      // A move the browser will no longer let anyone stop is a scroll already
      // under way: it started before the finger reached us, and it is not ours.
      if (!event.cancelable) {
        settle(true);
        return;
      }
      const now = { x: finger.clientX, y: finger.clientY };
      last = now;
      const card = swipeCard(from, now);
      // Every upright move is kept from the page, the climb inside the dead
      // zone and a dip back into it included — see `claimsMove`.
      if (claimsMove(from, now)) event.preventDefault();
      // Not yet carried and nothing to carry: the screen stays flat.
      if (!card.holds && carried === null) return;
      if (carried === null) {
        carried = screen();
        if (carried === null) return;
        const composer = findComposer();
        if (composer !== null && carried.contains(composer)) hold = holdSticky(composer, carried);
        revealHome(layer);
        fillScreen(carried);
        setLive(true);
      }
      carryScreen(carried, card);
      hold?.fit();
    };
    const onEnd = () => {
      const goesHome = start !== null && last !== null && swipeCard(start, last).armed;
      // Handed over before the card comes off, so the layer covers the screen
      // from the moment the thread lies flat until bb has drawn Home.
      if (goesHome) handingOver.current = handOverHome(layer, screen, () => setLive(false));
      settle(!goesHome);
      if (goesHome) current.current.toCompose();
    };
    const onCancel = () => settle(true);
    document.addEventListener("touchstart", onStart, true);
    document.addEventListener("touchmove", onMove, { capture: true, passive: false });
    document.addEventListener("touchend", onEnd, true);
    document.addEventListener("touchcancel", onCancel, true);
    return () => {
      settle(false);
      document.removeEventListener("touchstart", onStart, true);
      document.removeEventListener("touchmove", onMove, true);
      document.removeEventListener("touchend", onEnd, true);
      document.removeEventListener("touchcancel", onCancel, true);
    };
  }, [touch, inThread, layer]);

  return touch
    ? createPortal(
        <>
          <HomeSection box={sectionBox} live={live} />
          <HomeComposer box={box} />
        </>,
        layer,
      )
    : null;
}

// Where the section stands under the card when Home has not been seen: under
// bb's top bar, across the screen, down to its bottom edge, in px.
const SECTION_TOP = 56;

// How far in from each side of the screen that section stands, in px.
const SECTION_INSET = 16;

/** The section on `screen` if Home is on it, or `null` if it is not. */
function homeSection(screen: HTMLElement): Element | null {
  return screen.querySelector(`[data-testid=root-compose-compact-home] ${SECTION_SELECTOR}`);
}

/**
 * Threads Overview under the card, standing where it stood on Home: the real
 * list while a gesture is under way — drawn the moment it starts, so Home is
 * seen as it will open — and a skeleton of it the rest of the time.
 */
function HomeSection({ box, live }: { box: Box | null; live: boolean }) {
  const layout = useQueueLayout();
  // A measured box is the section's own, edge to edge; the fallback spans the
  // screen and keeps the list off its edges. The list stops at the box, as
  // Home's scroller stops it, instead of running on under the composer.
  const place: CSSProperties =
    box === null
      ? { top: SECTION_TOP, left: 0, right: 0, bottom: 0, paddingInline: SECTION_INSET }
      : { top: box.top, left: box.left, width: box.width, height: box.height };
  return (
    <div data-home-swipe-section="" style={{ position: "absolute", overflow: "hidden", ...place }}>
      {live ? <AttentionSection /> : <SectionSkeleton layout={layout} />}
    </div>
  );
}

// How many rows the skeleton draws: about a phone screen of the list.
const SKELETON_ROWS = 6;

/** The section's outline before its list is drawn: the heading, the project pills and a column of rows. */
function SectionSkeleton({ layout }: { layout: QueueLayout }) {
  const bar = "animate-pulse rounded-md bg-muted";
  return (
    <div data-home-swipe-skeleton="" className={cn("flex gap-3 pt-2", QUEUE_LAYOUT[layout].skeleton)}>
      <div className={cn(bar, "h-5 w-32")} />
      <div className={cn(bar, "h-8 w-2/3")} />
      <ul className="flex flex-col">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <li key={index} className="flex items-center gap-2 border-b border-border py-3 last:border-b-0">
            <div className={cn(bar, "size-5 shrink-0 rounded-full")} />
            <div className="flex flex-1 flex-col gap-1.5">
              <div className={cn(bar, "h-3.5 w-3/4")} />
              <div className={cn(bar, "h-3 w-1/3")} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Where the composer stands under the card when Home has not been seen: along
// the bottom edge, this far in from each side, in px.
const COMPOSER_INSET = 12;

/**
 * bb's own new-thread composer, as it stands on Home, set to the project the
 * section last chose. It lies in a layer nothing can touch, so it is never
 * submitted from; its draft is its own and starts empty.
 */
function HomeComposer({ box }: { box: ComposerBox | null }) {
  const projectId = useComposerProject();
  const place: CSSProperties =
    box === null
      ? { left: COMPOSER_INSET, right: COMPOSER_INSET, bottom: COMPOSER_INSET }
      : { left: box.left, width: box.width, bottom: box.bottom };
  return (
    <div style={{ position: "absolute", ...place }}>
      <NewThreadComposer
        layout="document"
        defaultProjectId={projectId ?? undefined}
        onSubmit={ignoreSubmit}
      />
    </div>
  );
}

function ignoreSubmit(): void {}

// How long bb's composer is looked for after the screen changes, in frames: a
// new screen draws its composer within a frame or two, a slow one within this.
const COMPOSER_LOOK_FRAMES = 120;

/**
 * bb's composer folded by a finger pulling it down, on a thread and on Home —
 * see `composer-fold.ts`. The composer comes and goes with the screen, so it is
 * looked for once a frame for a while after every change of screen, and again
 * at every touch; the fold's listeners go on whichever composer is found.
 */
function ComposerFold() {
  const { projectId, threadId } = useBbContext();
  const touch = useMediaQuery(TOUCH_QUERY);
  const [composer, setComposer] = useState<HTMLFormElement | null>(null);

  useEffect(() => (touch ? mountFoldStyle() : undefined), [touch]);

  useEffect(() => {
    if (!touch) return;
    const look = () => setComposer(findComposer());
    let frames = 0;
    let frame = 0;
    const poll = () => {
      look();
      frames += 1;
      if (frames < COMPOSER_LOOK_FRAMES) frame = window.requestAnimationFrame(poll);
    };
    poll();
    document.addEventListener("touchstart", look, { capture: true, passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("touchstart", look, true);
    };
  }, [touch, projectId, threadId]);

  useEffect(() => (composer !== null ? foldByDrag(composer) : undefined), [composer]);

  return null;
}

export default definePluginApp((app) => {
  app.slots.homepageSection({
    id: "needs-attention",
    title: SECTION_TITLE,
    component: AttentionSection,
  });
  // Feature-detected: an older bb without app overlays or composer surfaces keeps everything else.
  if (typeof app.slots.experimental_appOverlay === "function") {
    app.slots.experimental_appOverlay({ id: "home-swipe", component: HomeSwipe });
    app.slots.experimental_appOverlay({ id: "composer-fold", component: ComposerFold });
  }
  if (typeof app.composer?.customize === "function") {
    app.composer.customize({
      id: "composer-project",
      scopes: ["new-thread"],
      banners: [{ id: "composer-project", chrome: "bare", component: ComposerProjectWatch }],
    });
  }
  app.slots.experimental_threadList({
    id: "thread-preview",
    title: "Треды с превью по наведению",
    description: "Список тредов bb, у каждой строки — беседа, проект, ветка и модель по наведению.",
    component: SidebarWithPreview,
  });
});
