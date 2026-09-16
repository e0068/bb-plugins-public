// Layer 1 (core) — notifications as display actions. A click's toasts are
// values (./notification.ts); each is of one kind, and the rules of the click
// say which kinds it shows. The kinds split the way the toasts already did:
// the success with its detail lines, a warning for every shortfall, the
// repoint question, and errors.
import { actionsFor, type AutomationRules, type ClickTrigger, type NotifyActionId } from "./automation";
import type { Notification } from "./notification";

export function notificationKind(notification: Notification): NotifyActionId {
  if (notification.prompt !== undefined) return "notify.prompts";
  switch (notification.tone) {
    case "success":
      return "notify.result";
    case "warning":
      return "notify.warnings";
    case "error":
      return "notify.errors";
  }
}

/** The notifications of a click its rules show — one or many in, a list out. */
export function notificationsFor(
  rules: AutomationRules,
  trigger: ClickTrigger,
  input: readonly Notification[] | Notification,
): readonly Notification[] {
  const shown = new Set(actionsFor(rules, trigger));
  const list = "tone" in input ? [input as Notification] : (input as readonly Notification[]);
  return list.filter((n) => shown.has(notificationKind(n)));
}
