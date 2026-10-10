// Which thread a plugin page shows: the thread bb opened last, or the one the
// owner picked in the threads panel while on the page. Pure; selection-dom.ts
// keeps it once per window.
import { ownsPath } from "./core";

export interface Selection {
  /** The thread bb opened last or the owner picked; null before either. */
  readonly threadId: string | null;
  /** How many times the owner picked a thread on a plugin page — each pick is news, of the same thread too. */
  readonly picks: number;
}

export const NO_SELECTION: Selection = { threadId: null, picks: 0 };

/** bb opened a thread: it is the selected one now, quietly — no plugin page is open to follow it. */
export const visit = (selection: Selection, threadId: string): Selection =>
  threadId === selection.threadId ? selection : { ...selection, threadId };

/** The owner picked a thread in the panel on a plugin page: the page switches to it. */
export const pick = (selection: Selection, threadId: string): Selection => ({ threadId, picks: selection.picks + 1 });

export interface ClickKeys {
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/** A plain left click; a modifier keeps bb's own meaning — a split, a new window. */
export const isPlainClick = (click: ClickKeys): boolean =>
  click.button === 0 && !click.metaKey && !click.ctrlKey && !click.shiftKey && !click.altKey;

/** A page that is neither a thread nor a following plugin's: the owner did not come from a thread. */
export const leave = (selection: Selection): Selection =>
  selection.threadId === null ? selection : { ...selection, threadId: null };

/**
 * The thread of bb's thread page — `/threads/<id>` for the personal project,
 * `/projects/<projectId>/threads/<id>` for any other, either with a tail; null on any other page.
 */
export const threadOfPath = (pathname: string): string | null =>
  /^\/(?:projects\/[^/]+\/)?threads\/([^/]+)/.exec(pathname)?.[1] ?? null;

/**
 * The selection after bb moved to `pathname`: a thread page selects its
 * thread, a following plugin's page keeps the thread the owner came from,
 * any other page drops it.
 */
export function routed(selection: Selection, pathname: string, followerIds: readonly string[]): Selection {
  const threadId = threadOfPath(pathname);
  if (threadId !== null) return visit(selection, threadId);
  return ownsPath(followerIds, pathname) ? selection : leave(selection);
}

/**
 * The thread to mark in bb's threads panel: the selected one, on a following
 * plugin's page; on a thread page bb marks its own row, any other page marks none.
 */
export const markedThread = (selection: Selection, pathname: string, followerIds: readonly string[]): string | null =>
  ownsPath(followerIds, pathname) ? selection.threadId : null;

/** What a page follows: the thread it was entered with, or one the owner picked afterwards. */
export interface Follow {
  readonly kind: "entry" | "pick";
  readonly threadId: string;
}

/**
 * What a page follows now, or null. `seenPicks` is null until the page
 * followed once: then it follows the selected thread only if it was entered
 * at its root — a deep link names its own item. After that only a new pick moves it.
 */
export function followStep(seenPicks: number | null, enteredAtRoot: boolean, selection: Selection): Follow | null {
  const { threadId } = selection;
  if (threadId === null) return null;
  if (seenPicks === null) return enteredAtRoot ? { kind: "entry", threadId } : null;
  return selection.picks > seenPicks ? { kind: "pick", threadId } : null;
}
