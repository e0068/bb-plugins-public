// Layer 1 — which files of the branch are executable, read from git's index. Zero effects.
//
// The PR is rebuilt on GitHub from file contents (github-requests.ts), and
// contents carry no mode: without this every file landed as 100644, and an
// executable script (a `.command` for Finder, a hook) lost its bit on every
// PR opened through the steps. The index is where git keeps the mode.

/** The regular-file modes a GitHub tree entry can carry. */
export type FileMode = "100644" | "100755";

/** `git ls-files --stage -z`: every indexed path with its mode, NUL-separated so any path survives. */
export const STAGE_ARGS: readonly string[] = ["ls-files", "--stage", "-z"];

const EXECUTABLE = "100755";

/** Paths git keeps as executable, from `git ls-files --stage -z` output: `<mode> <sha> <stage>\t<path>\0`. */
export function executablePaths(stageOutput: string): ReadonlySet<string> {
  return new Set(
    stageOutput
      .split("\0")
      .filter((record) => record.startsWith(`${EXECUTABLE} `))
      .map((record) => record.slice(record.indexOf("\t") + 1)),
  );
}
