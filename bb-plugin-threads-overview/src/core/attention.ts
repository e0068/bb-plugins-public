// Pure attention model: which threads require the user, in what order, split
// into which groups, and which of those groups a swipe track is showing.
//
// No effects and no SDK imports — the frontend maps its live sidebar rows onto
// these shapes, and the tests pin the rules directly against them. Layer 1:
// depends on nothing.

/** Live work counts on a thread. All zero means nothing is running. */
export interface ThreadActivity {
  readonly workflows: number;
  readonly backgroundAgents: number;
  readonly backgroundCommands: number;
  readonly planMode: number;
  readonly goals: number;
}

/** The minimal thread facts the attention rules read. */
export interface ThreadFacts {
  readonly id: string;
  readonly projectId: string;
  readonly isArchived: boolean;
  /** The agent is blocked on the user: an approval or a question. */
  readonly hasPendingInteraction: boolean;
  /** The host's compact per-row state; "runtime" is a running foreground turn. */
  readonly indicator: string;
  readonly activity: ThreadActivity;
  /** Epoch ms the thread last wanted the user — its queue-entry time. */
  readonly latestAttentionAt: number;
}

function hasRunningWork(thread: ThreadFacts): boolean {
  const a = thread.activity;
  // Background commands are left out: a dev server or a watcher keeps running
  // after the agent has finished, and the thread then waits on the user.
  const background = a.workflows + a.backgroundAgents + a.planMode + a.goals;
  // `runtime` is a foreground turn, which the activity counts never cover.
  return background > 0 || thread.indicator === "runtime";
}

/** True when a background command — a dev server, a watcher — is still running. */
export function runsBackgroundCommand(thread: ThreadFacts): boolean {
  return thread.activity.backgroundCommands > 0;
}

/** True when the agent is actively doing work right now. */
export function isWorking(thread: ThreadFacts): boolean {
  // An agent blocked on the user is not working: it stands and waits, so the
  // thread belongs in the queue no matter what else is running under it.
  if (thread.hasPendingInteraction) return false;
  return hasRunningWork(thread);
}

/** A thread the queue may show at all: not archived and not postponed by the user. */
function mayQueue(thread: ThreadFacts, postponed: ReadonlySet<string>): boolean {
  return !thread.isArchived && !postponed.has(thread.id);
}

/**
 * A thread requires attention when work is not going on and the user has not
 * postponed it. Archived threads are never in the queue.
 */
export function needsAttention(
  thread: ThreadFacts,
  postponed: ReadonlySet<string>,
): boolean {
  return mayQueue(thread, postponed) && !isWorking(thread);
}

export type SortKey = "waiting-longest" | "waiting-newest";

function byId(a: ThreadFacts, b: ThreadFacts): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Order the attention queue. Total and deterministic — ties break by id. */
export function sortQueue(
  threads: readonly ThreadFacts[],
  sort: SortKey,
): readonly ThreadFacts[] {
  const copy = [...threads];
  switch (sort) {
    case "waiting-longest":
      return copy.sort(
        (a, b) => a.latestAttentionAt - b.latestAttentionAt || byId(a, b),
      );
    case "waiting-newest":
      return copy.sort(
        (a, b) => b.latestAttentionAt - a.latestAttentionAt || byId(a, b),
      );
  }
}

/**
 * Filter to the attention queue and order it in one pass. Asked to show
 * working threads, the queue takes them in too — still never an archived or a
 * postponed one — and orders them with the rest.
 */
export function attentionQueue(
  threads: readonly ThreadFacts[],
  postponed: ReadonlySet<string>,
  sort: SortKey,
  showWorking = false,
): readonly ThreadFacts[] {
  const inQueue = showWorking
    ? (thread: ThreadFacts) => mayQueue(thread, postponed)
    : (thread: ThreadFacts) => needsAttention(thread, postponed);
  return sortQueue(threads.filter(inQueue), sort);
}

/** One project's slice of the queue: a slide of the grouped view. */
export interface ProjectGroup {
  readonly projectId: string;
  readonly name: string;
  readonly threads: readonly ThreadFacts[];
}

/** A project as the left panel lists it; the list's order is the panel's. */
export interface ProjectEntry {
  readonly id: string;
  readonly name: string;
}

/** The name of a project the panel no longer lists. */
export const UNLISTED_NAME = "—";

/**
 * Split an already ordered queue into one group per project.
 *
 * Grouping never reorders threads — the caller's sort keeps holding inside each
 * group — and the groups themselves go in the order of `projects`, the left
 * panel's, so the row of buttons above the slides reads as the panel does. A
 * project the panel does not list goes after the listed ones.
 */
export function groupByProject(
  threads: readonly ThreadFacts[],
  projects: readonly ProjectEntry[],
): readonly ProjectGroup[] {
  const listed = new Map(projects.map((project, rank) => [project.id, { rank, name: project.name }]));
  const rankOf = (projectId: string) => listed.get(projectId)?.rank ?? projects.length;
  const groups = new Map<string, ThreadFacts[]>();
  for (const thread of threads) {
    const kept = groups.get(thread.projectId);
    if (kept === undefined) groups.set(thread.projectId, [thread]);
    else kept.push(thread);
  }
  return [...groups]
    .map(([projectId, grouped]) => ({
      projectId,
      name: listed.get(projectId)?.name ?? UNLISTED_NAME,
      threads: grouped,
    }))
    .sort(
      (a, b) =>
        rankOf(a.projectId) - rankOf(b.projectId) ||
        (a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0),
    );
}

/**
 * Which slide the swipe track is currently on: the one whose centre sits
 * closest to the centre of the visible area. Ties go to the earlier slide, and
 * an empty track is on slide 0.
 */
export function nearestSlideIndex(
  centers: readonly number[],
  viewportCenter: number,
): number {
  return centers.reduce(
    (best, centre, index) =>
      Math.abs(centre - viewportCenter) <
      Math.abs(centers[best]! - viewportCenter)
        ? index
        : best,
    0,
  );
}

/** The horizontal extent of a box on the page, in the same coordinates for every box compared. */
export interface Span {
  left: number;
  right: number;
}

/**
 * How far past each side of the section the swipe track may reach before the
 * nearest clipping box cuts it off. A section already wider than that box
 * reaches nowhere — the bleed never turns into an inset. Layout boxes land on
 * fractional pixels; the bleed is rounded down so the track stays inside the
 * box instead of overflowing it by a sub-pixel and scrolling the whole page.
 */
export function edgeBleed(section: Span, clip: Span): Span {
  return {
    left: Math.max(0, Math.floor(section.left - clip.left)),
    right: Math.max(0, Math.floor(clip.right - section.right)),
  };
}

/**
 * Where to scroll a row sideways so `item` is in full view in `view`, moving it
 * as little as possible from `scrollLeft`: an item already in view leaves the
 * row where it is, one cut off on an edge brings that edge just far enough. An
 * item wider than the row lines up with the row's left edge.
 */
export function revealScrollLeft(view: Span, item: Span, scrollLeft: number): number {
  const fitsInView = item.right - item.left <= view.right - view.left;
  if (item.left < view.left || !fitsInView) return scrollLeft + item.left - view.left;
  if (item.right > view.right) return scrollLeft + item.right - view.right;
  return scrollLeft;
}
