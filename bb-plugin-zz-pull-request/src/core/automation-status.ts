// Layer 1 (core) — the thread status as display actions. The sidebar row icon
// (./row-status.ts) takes one of seven states; each is an action, and the
// icon shows a state only when a rule holding the poll shows it. The poll is
// the only trigger that reaches the icon: its content script asks `rowFacts`
// on its own 20-second timer and on nothing else.
import { STATUS_ACTION_IDS, type AutomationRules, type StatusActionId } from "./automation";
import type { RowState } from "./row-status";

export const STATUS_ACTIONS = STATUS_ACTION_IDS;

/** The statuses rules show: those in a rule that holds the 20-second poll. */
export function statusesShown(rules: AutomationRules): ReadonlySet<StatusActionId> {
  return new Set(
    rules.rules
      .filter((r) => r.triggers.includes("state.poll"))
      .flatMap((r) => r.actions)
      .filter((a): a is StatusActionId => a.startsWith("status.")),
  );
}

/** Whether the icon may show this state; clearing it is always allowed. */
export function rowStateShown(rules: AutomationRules, state: RowState): boolean {
  return state.kind === "none" || statusesShown(rules).has(`status.${state.kind}`);
}
