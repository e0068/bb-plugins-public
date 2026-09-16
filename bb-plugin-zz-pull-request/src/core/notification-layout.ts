// Layer 1 — which of a notification's addresses gets the toast's single
// button, and which are drawn as lines instead.
//
// A failure carries two places to go: the Pull Request and the thread that
// owns it. The slot used to be a first-match-wins chain inside notify.tsx, so
// the loser was dropped — a merge that fell over named a PR it gave no way to
// open. As a value the rule is testable without a DOM.
import type { Notification, NotificationLink } from "./notification";
import type { PendingRepoint } from "./reinstall-plan";

/** What the toast's one button does. */
export type NotificationAction =
  /** Runs the repoint the notification proposes — the only action that changes anything. */
  | { readonly kind: "repoint"; readonly label: string; readonly repoint: PendingRepoint }
  | { readonly kind: "thread"; readonly label: string; readonly threadId: string }
  | { readonly kind: "url"; readonly label: string; readonly url: string };

export interface NotificationLayout {
  readonly action: NotificationAction | null;
  /** Links the button had no room for; shown as lines under the details. */
  readonly linkLines: readonly NotificationLink[];
}

/**
 * A prompt's confirm button first — it is the point of that toast. Then the
 * thread jump: on a failure, knowing which thread owns the news beats
 * following the PR out. Whatever loses the slot becomes a line, never nothing.
 */
export function notificationLayout(notification: Notification): NotificationLayout {
  const { prompt, threadLink, link } = notification;
  const lines = link === null ? [] : [link];
  if (prompt) {
    return {
      action: { kind: "repoint", label: prompt.confirmLabel, repoint: prompt.repoint },
      linkLines: lines,
    };
  }
  if (threadLink) {
    return {
      action: { kind: "thread", label: threadLink.label, threadId: threadLink.threadId },
      linkLines: lines,
    };
  }
  if (link !== null) return { action: { kind: "url", label: link.label, url: link.url }, linkLines: [] };
  return { action: null, linkLines: [] };
}
