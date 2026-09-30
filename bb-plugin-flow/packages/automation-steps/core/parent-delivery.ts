// Layer 1 — whether a thread hands its work to its parent thread instead of
// to GitHub. Zero effects: the thread's and the parent's branches arrive as
// values, the answer is a value.
//
// A child thread spawned from its parent's branch (a wave of an umbrella task)
// has that branch as its base. bb never pushes a thread's branch — a PR is one
// commit built through the API — so the parent's branch has no copy on origin:
// fetching it fails, and a PR into it cannot be opened. Such a thread's work
// goes into the parent's branch locally, in the parent's own working copy; the
// parent's PR later carries all of it to main. Every other thread — a root
// one, or a child based on main, even when its parent sits on main too —
// goes the usual way: the default branch is on origin.

/** Where a child thread's work goes: its branch, into the parent's branch checked out at the parent's path. */
export interface ParentDelivery {
  readonly branch: string;
  readonly parentBranch: string;
  readonly parentPath: string;
}

export interface ParentDeliveryInput {
  /** The thread's base branch, bare (no `origin/`). */
  readonly base: string | null;
  /** The repository's default branch, bare — the one branch known to be on origin. */
  readonly defaultBranch: string | null;
  /** The thread's own branch. */
  readonly branch: string | null;
  /** The parent thread's environment; `null` for a thread without a parent. */
  readonly parent: { readonly branchName: string | null; readonly path: string | null } | null;
}

/** Total: `null` means "the usual way", a value names exactly where the work goes. */
export function parentDelivery({ base, defaultBranch, branch, parent }: ParentDeliveryInput): ParentDelivery | null {
  if (parent === null || base === null || branch === null || base === defaultBranch) return null;
  const { branchName: parentBranch, path: parentPath } = parent;
  if (parentBranch !== base || parentPath === null || branch === parentBranch) return null;
  return { branch, parentBranch, parentPath };
}

/** What the parent thread is told once a child thread's branch is in its own. */
export interface DeliveredWave {
  /** The child thread's title; `null` when it has none. */
  readonly title: string | null;
  readonly branch: string;
  readonly parentBranch: string;
  /** The parent branch's head after the merge. */
  readonly head: string;
}

const SHORT_SHA = 7;

/**
 * The note for the parent thread's agent. Without it the agent looks for a PR
 * into main, finds none and starts the next wave from main — without this one.
 */
export const parentNote = ({ title, branch, parentBranch, head }: DeliveredWave): string =>
  [
    `Child thread "${title ?? branch}" merged its branch ${branch} into your branch ${parentBranch}; ${parentBranch} is now at ${head.slice(0, SHORT_SHA)}.`,
    `There is no PR for it on GitHub and none is needed: your own PR carries this work to main.`,
    `Start the next child threads from ${parentBranch}, not from main.`,
  ].join("\n");
