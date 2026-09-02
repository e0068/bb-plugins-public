// Layer 1 — reads git's answer to "is the branch's content already in the
// base?". Zero effects.
//
// The question cannot be answered by SHAs or ancestry: the plugin opens PRs
// through the GitHub API without a push, so the commit inside the PR is
// synthetic and never equals the local HEAD, while squash and merge both put
// a differently-SHA'd commit into the base. Content is the only thing that
// survives all three representations — see
// memory/decisions/pr-button-merged-by-content.md.
//
// The measurement itself is `git merge-tree --write-tree <base> HEAD`: it
// merges the branch into the base WITHOUT a working copy and prints the
// resulting tree. Equal to the base's own tree means merging would add
// nothing — the content is already in. This also survives the base moving
// ahead with other people's commits, which a plain "diff against base is
// empty" check does not.

/** What a git command returned: its exit code and stdout. The shell maps its own run type onto this. */
export interface CommandOutcome {
  code: number;
  stdout: string;
}

/**
 * - `merged` — merging the branch into the base would change nothing;
 * - `not-merged` — the branch still carries content of its own (including the conflict case);
 * - `unknown` — git gave no usable answer (no network, a broken repository, an unexpected exit code).
 */
export type MergedContent = "merged" | "not-merged" | "unknown";

// `merge-tree` exits with 1 on a conflict — and a conflict is a real answer:
// the sides diverged, so there is something left to open a PR for. Anything
// above 1 is git itself failing, and that is not an answer at all.
const CONFLICT_CODE = 1;

export function decideMergedContent(input: {
  mergeTree: CommandOutcome;
  baseTree: CommandOutcome;
}): MergedContent {
  const { mergeTree, baseTree } = input;
  if (mergeTree.code === CONFLICT_CODE) return "not-merged";
  if (mergeTree.code !== 0 || baseTree.code !== 0) return "unknown";

  const merged = firstLine(mergeTree.stdout);
  const base = firstLine(baseTree.stdout);
  if (merged === "" || base === "") return "unknown";
  return merged === base ? "merged" : "not-merged";
}

/**
 * Folds the measured fact together with the cached "this HEAD was already
 * merged" flag: the fact wins whenever there is one, the cache answers only
 * when there is none. The cache exists so the expensive git run happens once
 * per HEAD rather than on every poll.
 */
export function resolveAlreadyMerged(content: MergedContent, cachedHeadMatches: boolean): boolean {
  switch (content) {
    case "merged":
      return true;
    case "not-merged":
      return false;
    case "unknown":
      return cachedHeadMatches;
  }
}

function firstLine(stdout: string): string {
  return stdout.split("\n", 1)[0].trim();
}
