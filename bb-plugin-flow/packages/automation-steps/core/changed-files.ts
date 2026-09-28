// Layer 1 — classifies the status of a changed git file. Zero effects.
// Based on this decision the shell either reads the new content (upsert) or
// records a deletion in the tree. Statuses come from bb `environments.status`.

export type GitFileStatus = "?" | "??" | "A" | "C" | "D" | "M" | "R" | "U";

export interface BranchFile {
  path: string;
  status: GitFileStatus;
}

/**
 * Only `D` means the file was deleted from the tree. Everything else (added,
 * modified, copied, renamed, untracked) requires new content, i.e. an upsert.
 * `U` (conflict) doesn't occur in a clean tree; treated as an upsert.
 */
export function isDeletion(status: GitFileStatus): boolean {
  return status === "D";
}

/** Only a rename hides a deletion from bb's list; without one the list is complete and git needn't be asked. */
export function hasRenames(files: readonly BranchFile[]): boolean {
  return files.some((file) => file.status === "R");
}

/**
 * `git diff --no-renames --diff-filter=D --name-only -z <merge-base> HEAD` —
 * every path the branch removed, a rename's old side included: bb lists a
 * rename as one `R` line under its new path, and the old one is never named.
 * `-z` keeps paths with spaces and non-ASCII letters unquoted.
 */
export function deletedPathsArgs(mergeBaseSha: string): readonly string[] {
  return ["diff", "--no-renames", "--diff-filter=D", "--name-only", "-z", mergeBaseSha, "HEAD"];
}

/** The NUL-separated path list `-z` prints. */
export function parseNulPaths(stdout: string): string[] {
  return stdout.split("\0").filter((path) => path !== "");
}

/**
 * bb's changed files plus a deletion for every removed path it doesn't list
 * as one — the old side of each rename. Without it the PR's tree gets the
 * new path and keeps the old one: a move lands in the base as a copy.
 */
export function withDeletedPaths(files: readonly BranchFile[], deleted: readonly string[]): BranchFile[] {
  const listed = new Set(files.filter((file) => isDeletion(file.status)).map((file) => file.path));
  const unlisted = [...new Set(deleted)].filter((path) => !listed.has(path));
  return [...files, ...unlisted.map((path): BranchFile => ({ path, status: "D" }))];
}
