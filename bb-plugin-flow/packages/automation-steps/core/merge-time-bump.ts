// Layer 1 — what a plugin's version must become at the moment its PR is
// merged, given the branch's package.json and the base branch's. Zero
// effects; reading either file and writing the result are in the shell.
//
// Why the decision is made here and not (only) at PR creation: the bump
// written when the PR is opened is computed from a snapshot that goes stale.
// Any neighbouring PR touching the same plugin moves that plugin's version
// on the base, and every branch cut before it then carries a version that is
// no longer ahead. The create-time gate (resolveLiveBumpSource in
// plugin-version-bump.ts) reacts by skipping the bump entirely — correct in
// that it never builds a conflicting commit, but it means a merged change
// can land with no version growth at all, which is what happened to a third
// of the plugin merges in this repo. See
// memory/decisions/version-bump-decided-at-merge.md.
//
// The rule here is the one that survives any interleaving: the version must
// end up strictly greater than what the base already has, so it is computed
// from the base's value, not from the branch's.
//
// Which component grows is the chain's own choice: the step the user put in
// it (files.bump-major/minor/patch) names the level, and the target is that
// level applied to the BASE's version — once. A branch already standing on
// that target (a second press, or a chain re-run) is "ahead" and is left
// alone, so the level never compounds.
import { bumpBy, topLevelVersion, type BumpLevel } from "./plugin-version-bump";

export type MergeTimeBumpPlan =
  /** The branch is already strictly ahead of the base — merging it grows the version on its own. */
  | { kind: "ahead" }
  /** The branch is not ahead: set its version to `to` before merging. */
  | { kind: "bump"; to: string }
  /** Neither ahead nor safely bumpable — a human decides. Never silently skipped: the reason is surfaced. */
  | { kind: "unknown"; reason: string };

const PLAIN_SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

type Parsed = readonly [number, number, number];

/**
 * `headJson` is the plugin's package.json as the branch has it, `baseJson`
 * as the base branch has it right now (null when the base has no such file
 * — a plugin this branch introduces, which is ahead of nothing). `level` is
 * the component the chain asked to raise; with "patch" this is exactly the
 * historical rule "one patch past the base".
 */
export function planMergeTimeBump(
  headJson: string | null,
  baseJson: string | null,
  level: BumpLevel,
): MergeTimeBumpPlan {
  const head = parseVersion(headJson);
  if (!head) return { kind: "unknown", reason: "no readable version on the branch" };

  if (baseJson === null) return { kind: "ahead" };
  const base = parseVersion(baseJson);
  if (!base) return { kind: "unknown", reason: "no readable version on the base" };

  const to = bumpBy(base[0], base[1], base[2], level);
  const target = parsePlain(to);
  if (target && compare(head, target) >= 0) return { kind: "ahead" };
  return { kind: "bump", to };
}

function parseVersion(json: string | null): Parsed | null {
  return json === null ? null : parsePlain(topLevelVersion(json) ?? "");
}

function parsePlain(version: string): Parsed | null {
  const matched = PLAIN_SEMVER.exec(version);
  return matched ? [Number(matched[1]), Number(matched[2]), Number(matched[3])] : null;
}

function compare(a: Parsed, b: Parsed): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
