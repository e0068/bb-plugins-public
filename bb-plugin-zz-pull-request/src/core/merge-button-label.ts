// Layer 1 — the text on the "Merge" segment of the header's split control.
// Zero effects.
//
// The control shows the PR number exactly once. Normally it lives in the
// link segment on the left ("PR #275"), and the action beside it is a plain
// "Merge"; when there is no link to render — the best-effort url or number
// came back null — the number moves into the action instead.
export interface MergeButtonLabelInput {
  /** GitHub refuses this merge outright — the label names that instead of a PR. */
  conflicting: boolean;
  /** The PR number, or `null` when it couldn't be determined. */
  number: number | null;
  /** Whether the PR-link segment is rendered to the left — it already carries the number. */
  linked: boolean;
}

export function mergeButtonLabel({ conflicting, number, linked }: MergeButtonLabelInput): string {
  if (conflicting) return "Conflicts";
  if (linked || number === null) return "Merge";
  return `Merge #${number}`;
}
