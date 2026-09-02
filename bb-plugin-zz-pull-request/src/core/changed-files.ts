// Layer 1 — classifies the status of a changed git file. Zero effects.
// Based on this decision the shell either reads the new content (upsert) or
// records a deletion in the tree. Statuses come from bb `environments.status`.

export type GitFileStatus = "?" | "??" | "A" | "C" | "D" | "M" | "R" | "U";

/**
 * Only `D` means the file was deleted from the tree. Everything else (added,
 * modified, copied, renamed, untracked) requires new content, i.e. an upsert.
 * `U` (conflict) doesn't occur in a clean tree; treated as an upsert.
 */
export function isDeletion(status: GitFileStatus): boolean {
  return status === "D";
}
