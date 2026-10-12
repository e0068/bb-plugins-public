// Layer 1 — "is this list row the workflow that's open in the builder?".
// Pure comparison, no I/O; the store above and the panel both address a
// workflow the same way, so the answer belongs in one tested function rather
// than in a `===` inside the list's JSX.

import type { StoreKind } from "./store";

/** How a workflow is addressed: its store plus either of its two names. */
export interface WorkflowRef {
  store: StoreKind;
  path: string;
  name: string;
}

/**
 * Same workflow — same store and either the same absolute path or the same
 * file name.
 *
 * The name has to count, not just the path: `wfList` unions all of a
 * project's checkouts (source plus git worktrees) and keeps the first one
 * that has the file, while `wfSave` always writes into the default checkout.
 * One workflow then has two absolute paths that differ only by checkout root,
 * and comparing paths alone left the open workflow unhighlighted in its own
 * list. Names are unique within a store — the project list is deduped by name
 * and the global store is one flat directory — so this can't collapse two
 * different files into one.
 */
export function isSameWorkflow(
  open: WorkflowRef | null,
  row: WorkflowRef,
): boolean {
  if (open === null) return false;
  if (open.store !== row.store) return false;
  return open.path === row.path || open.name === row.name;
}
