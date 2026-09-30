// Layer 1 — what a file may be renamed to, and where the renamed file lands.
// Pure and free of React: the rename dialog and the plugin's server both
// import it, so the two can never disagree about which name is allowed.

/** The last segment of a path. */
export const fileNameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** The path a file gets when renamed to `name` without leaving its folder. */
export const siblingPath = (path: string, name: string): string =>
  `${path.slice(0, path.lastIndexOf("/") + 1)}${name}`;

/** Why `name` can't replace the name of the file at `currentPath`, or null. */
export function renameProblem(name: string, currentPath: string): string | null {
  if (name.trim() === "") return "Name is empty.";
  if (/[/\\]/.test(name)) return "Name can't contain a slash.";
  if (name === "." || name === "..") return "Name can't be . or ..";
  if (name === fileNameOf(currentPath)) return "That's the current name.";
  return null;
}
