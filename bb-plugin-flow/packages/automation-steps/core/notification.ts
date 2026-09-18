// What the plugin has to say, as values — no toasts here.
//
// Every button in app.tsx used to call `toast.*` straight from its result
// handler, so a single merge fired three separate short-lived lines ("Pull
// Request merged", "Reinstalled tasks-plus", "main pulled") and none of them
// carried the PR number the button already knew. Folding an outcome into
// notifications is a pure function of that outcome; only `useNotify` in
// src/ui/notify.tsx turns one into a toast.
//
// The split that runs through all of it: one success per action, carrying
// everything that went right as detail lines, and a separate notification for
// every way something fell short — a warning must never be folded into a
// success where it reads as part of the good news.

import type { PendingRepoint } from "./reinstall-plan";

export type NotificationTone = "success" | "warning" | "error";

/** Where a notification can take the user; the only interactive part of one. */
export interface NotificationLink {
  readonly label: string;
  readonly url: string;
}

/**
 * A jump to a BB thread — the failure-path counterpart of `NotificationLink`.
 * A merge that GitHub refuses is usually seen from a thread the user has
 * already left (toasts persist), so the toast has to name the PR AND carry a
 * way back to the thread that owns it. When both `link` and `threadLink` are
 * present, the thread jump wins as the action — the URL stays reachable
 * through the title text of the toast title.
 */
export interface NotificationThreadLink {
  readonly label: string;
  readonly threadId: string;
}

/** The thread a failure can send the user back to, and what the button says. */
export interface ThreadRef {
  readonly id: string;
  readonly label: string;
}

/**
 * A leg that did not go through AFTER the Pull Request already existed. The
 * PR is real, so the news splits in two: the success keeps what was achieved,
 * the error names what broke — both linked to the PR.
 */
export interface MergeFailure {
  readonly step: "merge";
  readonly message: string;
}

export interface ArchiveFailure {
  readonly step: "archive";
  readonly message: string;
}

/** Split per step: a chain that never archives cannot fail at archiving. */
export type PrFailure = MergeFailure | ArchiveFailure;

/**
 * A question with two answers — the one notification that changes something
 * when acted on. A repoint removes a plugin (settings, secrets and schedules
 * with it) before installing it from git, so the merge only proposes it; the
 * confirm button runs it, the cancel button leaves everything as it is.
 */
export interface NotificationPrompt {
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly repoint: PendingRepoint;
}

export interface Notification {
  readonly tone: NotificationTone;
  readonly title: string;
  /** Secondary facts of the same event, one per line under the title. */
  readonly details: readonly string[];
  readonly link: NotificationLink | null;
  readonly threadLink?: NotificationThreadLink;
  readonly prompt?: NotificationPrompt;
}

export interface VersionBumpOutcome {
  readonly bumped: readonly { readonly root: string; readonly to: string }[];
  readonly problems: readonly string[];
}

export interface ReinstallOutcome {
  /** Updated in place — they already tracked the PR's repository. */
  readonly reinstalled: readonly string[];
  /** Installed afresh — nothing was under their id. */
  readonly installed: readonly string[];
  /** Waiting for the user's word — see `NotificationPrompt`. */
  readonly repoints: readonly PendingRepoint[];
  readonly problems: readonly string[];
}

/** A task that WAS linked to the thread but whose status transition failed. */
export interface FailedTask {
  readonly key: string;
  readonly reason: string;
}

interface MergeEffects {
  readonly versionBump: VersionBumpOutcome;
  readonly reinstall: ReinstallOutcome;
}

interface TaskOutcome {
  readonly failedTasks: readonly FailedTask[];
  readonly taskCliError: string | null;
}

const LINK_LABEL = "View on GitHub";

const success = (title: string, details: readonly string[], link: NotificationLink | null): Notification => ({
  tone: "success",
  title,
  details,
  link,
});

const warning = (title: string): Notification => ({
  tone: "warning",
  title,
  details: [],
  link: null,
});

const prLink = (url: string | null): NotificationLink | null =>
  url === null ? null : { label: LINK_LABEL, url };

const STEP_FAILED: Record<PrFailure["step"], string> = {
  merge: "the merge failed",
  archive: "the thread was not archived",
};

// Titled by the success it follows — "Pull Request #276 opened, but the merge
// failed: …" — so a toast read hours later names the PR that DOES exist first.
function prFailureNotification(
  achieved: string,
  failure: PrFailure,
  url: string | null,
  thread: ThreadRef,
): Notification {
  return {
    tone: "error",
    title: `${achieved}, but ${STEP_FAILED[failure.step]}: ${failure.message}`,
    details: [],
    link: prLink(url),
    threadLink: { label: thread.label, threadId: thread.id },
  };
}

/** One place, three builders. */
const failureIf = (
  achieved: string,
  failure: PrFailure | null,
  url: string | null,
  thread: ThreadRef,
): readonly Notification[] => (failure === null ? [] : [prFailureNotification(achieved, failure, url, thread)]);

/** Lines only when there is something to say — an empty list must add no line. */
const lineIf = (present: boolean, line: () => string): readonly string[] => (present ? [line()] : []);

/** What a merge did besides merging, in the order it happened. */
export function mergeEffectDetails({ versionBump, reinstall }: MergeEffects): readonly string[] {
  // The local main is fast-forwarded after the merge too, but silently: its
  // success needs no line (the toast would only outlive the moment it mattered),
  // and its failure is already shown by the "main not pulled" badge that takes
  // the Merge button's place on the next refetch.
  return [
    ...lineIf(
      versionBump.bumped.length > 0,
      () => `Bumped ${versionBump.bumped.map(({ root, to }) => `${root} to ${to}`).join(", ")}`,
    ),
    ...lineIf(reinstall.reinstalled.length > 0, () => `Reinstalled ${reinstall.reinstalled.join(", ")}`),
    ...lineIf(reinstall.installed.length > 0, () => `Installed ${reinstall.installed.join(", ")}`),
  ];
}

/**
 * A plugin the merge could not bring onto the new code without removing it
 * first: the facts of the trade, and the two buttons. Stays open until the
 * user answers — like every notification here, but this one is the reason.
 */
export function repointPrompt(repoint: PendingRepoint): Notification {
  return {
    tone: "warning",
    title: `Repoint ${repoint.pluginId} to git?`,
    details: [
      `Installed from ${repoint.from}`,
      `Would be removed and installed from ${repoint.source}`,
      "Removing deletes the plugin's settings, secrets and schedules",
    ],
    link: null,
    prompt: { confirmLabel: "Repoint to git", cancelLabel: "Keep as is", repoint },
  };
}

/** The answer to a confirmed prompt. */
export function repointedNotification(pluginId: string): Notification {
  return success(`Repointed ${pluginId} to git`, [], null);
}

/**
 * Every way a merge's side effects fell short. Each is its own warning, never
 * a line inside the success: a plugin change landing on a version that already
 * existed is exactly the news this step exists to stop losing. A plugin that
 * still runs its old source is such a shortfall too — with a way to end it.
 */
export function mergeEffectWarnings({
  versionBump,
  reinstall,
}: MergeEffects): readonly Notification[] {
  return [
    ...versionBump.problems.map((problem) => warning(`Version not bumped: ${problem}`)),
    ...reinstall.problems.map((problem) => warning(`Plugin not reinstalled: ${problem}`)),
    ...reinstall.repoints.map(repointPrompt),
  ];
}

/**
 * Tasks that were found linked to the thread but whose transition failed.
 * `did` names the action that DID succeed, so the warning can't be misread as
 * "the whole thing failed"; `transition` is the status it was headed for.
 */
export function taskWarnings({
  failedTasks,
  did,
  transition,
}: {
  readonly failedTasks: readonly FailedTask[];
  readonly did: string;
  readonly transition: string;
}): readonly Notification[] {
  return failedTasks.map(({ key, reason }) =>
    warning(`${did}, but could not mark ${key} ${transition}: ${reason}`),
  );
}

/**
 * The bb CLI could not be run at all, so no linked task was even looked up.
 * Deliberately loud: this is not "the thread has no task" (silent and
 * ordinary) but a promise the plugin failed to keep without anyone noticing —
 * the state that let every status transition die quietly while `bb` was
 * unreachable from the plugin host.
 */
export function cliWarnings(reason: string | null): readonly Notification[] {
  return reason === null
    ? []
    : [warning(`Linked tasks were left untouched — the bb CLI could not run: ${reason}`)];
}

/** A rejected RPC call. The error's own message beats a generic sentence. */
export function errorNotification(error: unknown, fallback: string): Notification {
  return {
    tone: "error",
    title: error instanceof Error ? error.message : fallback,
    details: [],
    link: null,
  };
}

/**
 * The Merge button's error: same as `errorNotification`, plus the PR number
 * pinned to the title, the link out to that PR, and a jump back to the owning
 * thread. GitHub's own refusal ("HTTP 409: Pull request is not currently
 * mergeable") names nothing, so without this the persistent toast reads as an
 * anonymous complaint that the user, having moved on to another thread, cannot
 * act on. Both addresses travel together: the thread jump takes the button,
 * the PR link becomes a line of the toast (see src/core/notification-layout.ts).
 */
export function mergeErrorNotification(
  error: unknown,
  fallback: string,
  pr: { readonly number: number | null; readonly url: string | null },
  thread: ThreadRef,
): Notification {
  const base = errorNotification(error, fallback);
  return {
    ...base,
    title: pr.number === null ? base.title : `Pull Request #${pr.number}: ${base.title}`,
    link: prLink(pr.url),
    threadLink: { label: thread.label, threadId: thread.id },
  };
}

const markedInReview = (keys: readonly string[]): readonly string[] =>
  lineIf(keys.length > 0, () => `Marked ${keys.join(", ")} in review`);

// Two facts, one of them the archive: a `done` transition that went through is
// news whether or not the archive after it did. Folding both into `archived`
// lost the first exactly when the thread was left behind.
const archivedDetail = (archived: boolean, doneTasks: readonly string[]): readonly string[] =>
  archived
    ? [
        doneTasks.length > 0
          ? `Marked ${doneTasks.join(", ")} done and archived the thread`
          : "Thread archived",
      ]
    : lineIf(doneTasks.length > 0, () => `Marked ${doneTasks.join(", ")} done`);

const taskTroubles = ({ failedTasks, taskCliError }: TaskOutcome, did: string, transition: string) => [
  ...taskWarnings({ failedTasks, did, transition }),
  ...cliWarnings(taskCliError),
];

export function prOpenedNotifications(
  result: TaskOutcome & {
    readonly number: number;
    readonly url: string;
    readonly inReviewTasks: readonly string[];
  },
): readonly Notification[] {
  return [
    success(`Pull Request #${result.number} opened`, markedInReview(result.inReviewTasks), prLink(result.url)),
    ...taskTroubles(result, "Opened the PR", "in review"),
  ];
}

/**
 * "Pull Request then Merge". The merge may not have gone through; the PR is
 * open either way, and the success claims only what happened.
 */
export function prOpenedAndMergedNotifications(
  result: TaskOutcome &
    MergeEffects & {
      readonly number: number;
      readonly url: string;
      readonly inReviewTasks: readonly string[];
      readonly failure: MergeFailure | null;
    },
  thread: ThreadRef,
): readonly Notification[] {
  const merged = result.failure === null;
  const achieved = `Pull Request #${result.number} ${merged ? "opened and merged" : "opened"}`;
  return [
    success(
      achieved,
      [...markedInReview(result.inReviewTasks), ...mergeEffectDetails(result)],
      prLink(result.url),
    ),
    ...failureIf(achieved, result.failure, result.url, thread),
    ...mergeEffectWarnings(result),
    ...taskTroubles(result, merged ? "Opened and merged the PR" : "Opened the PR", "in review"),
  ];
}

/**
 * "Pull Request, Merge then Archive" — two ways to stop short of its own name.
 * The success is titled by how far it got, never by what it set out to do.
 */
export function prOpenedMergedArchivedNotifications(
  result: TaskOutcome &
    MergeEffects & {
      readonly number: number;
      readonly url: string;
      readonly archived: boolean;
      readonly doneTasks: readonly string[];
      readonly failure: PrFailure | null;
    },
  thread: ThreadRef,
): readonly Notification[] {
  const merged = result.failure?.step !== "merge";
  const achieved = `Pull Request #${result.number} ${merged ? "opened and merged" : "opened"}`;
  return [
    success(
      achieved,
      [...mergeEffectDetails(result), ...archivedDetail(result.archived, result.doneTasks)],
      prLink(result.url),
    ),
    ...failureIf(achieved, result.failure, result.url, thread),
    ...mergeEffectWarnings(result),
    // What a task warning may claim is what actually happened, not what the
    // menu item was called: after a refused archive the thread is still open.
    ...taskTroubles(
      result,
      result.archived ? "Archived the thread" : merged ? "Opened and merged the PR" : "Opened the PR",
      "done",
    ),
  ];
}

/**
 * The plain Merge button. Its number and URL come from `mergeState` (already
 * on screen as the button's label), not from the merge result — which is why
 * both can be missing when git could not resolve the open PR.
 */
export function prMergedNotifications({
  pr,
  ...effects
}: MergeEffects & {
  readonly pr: { readonly number: number | null; readonly url: string | null };
}): readonly Notification[] {
  return [
    success(
      pr.number === null ? "Pull Request merged" : `Pull Request #${pr.number} merged`,
      mergeEffectDetails(effects),
      prLink(pr.url),
    ),
    ...mergeEffectWarnings(effects),
  ];
}

/**
 * The Merge button's "Merge then Archive" item: the plain merge notification
 * with the archive as one more detail line under it. Like the plain merge,
 * the PR number and URL come from `mergeState` rather than the result —
 * the archive RPC never learns them — so both may be missing.
 */
export function prMergedArchivedNotifications(
  {
    pr,
    ...result
  }: TaskOutcome &
    MergeEffects & {
      readonly pr: { readonly number: number | null; readonly url: string | null };
      readonly archived: boolean;
      readonly doneTasks: readonly string[];
      readonly failure: ArchiveFailure | null;
    },
  thread: ThreadRef,
): readonly Notification[] {
  const achieved = pr.number === null ? "Pull Request merged" : `Pull Request #${pr.number} merged`;
  return [
    success(
      achieved,
      [...mergeEffectDetails(result), ...archivedDetail(result.archived, result.doneTasks)],
      prLink(pr.url),
    ),
    ...failureIf(achieved, result.failure, pr.url, thread),
    ...mergeEffectWarnings(result),
    ...taskTroubles(result, result.archived ? "Archived the thread" : "Merged the PR", "done"),
  ];
}

export function threadArchivedNotifications(
  result: TaskOutcome & { readonly doneTasks: readonly string[] },
): readonly Notification[] {
  return [
    success(
      result.doneTasks.length > 0
        ? `Marked ${result.doneTasks.join(", ")} done and archived the thread`
        : "Thread archived",
      [],
      null,
    ),
    ...taskTroubles(result, "Archived the thread", "done"),
  ];
}
