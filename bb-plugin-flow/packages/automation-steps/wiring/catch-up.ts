// Layer 3 (shell), the testable part — orchestrates catching the branch up with the tip of its base:
// fetch (mode "origin") → tracked changes → live behind/ahead → up-to-date,
// fast-forward or merge. A conflicted merge is aborted whole and reported with
// its files, so the tree is never left half-merged. The decision is
// core/catch-up.ts; the process is git-client.ts behind GitPorts.
import type { ResolvedBase } from "../core/base-branch";
import { conflictedFilesArgs, decideCatchUp, mergeAbortArgs, mergeBaseArgs, mergeInProgressArgs, trackedChangesArgs } from "../core/catch-up";
import { aheadCountArgs, behindCountArgs, fastForwardArgs, fetchBaseArgs } from "../core/git-commands";
import { gitRunMessage, type GitPorts, type GitRun } from "./git-run";

export type CatchUpOutcome = "up-to-date" | "fast-forwarded" | "merged";

const must = async (ports: GitPorts, args: readonly string[], what: string): Promise<string> => {
  const result = await ports.run(args);
  if (result.code !== 0) throw new Error(`${what}: ${gitRunMessage(result)}`);
  return result.stdout;
};

const count = async (ports: GitPorts, args: readonly string[]): Promise<number> => {
  const text = (await must(ports, args, `git ${args.join(" ")}`)).trim();
  const n = Number.parseInt(text, 10);
  if (!Number.isInteger(n)) throw new Error(`git ${args.join(" ")} gave no count: ${text}`);
  return n;
};

/**
 * A failed merge: git refused before starting — its own text; conflicts —
 * abort and name the files, or say the tree is left mid-merge.
 *
 * The file names come FIRST. The step's error is shown on one line in the
 * flow's progress bar, and that line is cut to the width of the panel: a
 * message that opens with "Merging origin/main into the branch has
 * conflicts…" spends the visible part on words the owner already knows and
 * cuts away the only thing they need — which files to go and resolve.
 */
const failedMerge = async (ports: GitPorts, ref: string, merged: GitRun): Promise<Error> => {
  const conflicts = (await ports.run(conflictedFilesArgs())).stdout.split("\n").map((f) => f.trim()).filter((f) => f !== "");
  if (conflicts.length === 0) return new Error(`could not merge ${ref}: ${gitRunMessage(merged)}`);
  const aborted = await ports.run(mergeAbortArgs());
  const named = conflicts.join(", ");
  return aborted.code === 0
    ? new Error(`${named} — conflicts with ${ref}. The merge was aborted, the branch is untouched: resolve them in the working copy, commit the merge, and run the step again.`)
    : new Error(`${named} — conflicts with ${ref}, and git merge --abort failed too, so the tree is left mid-merge: ${gitRunMessage(aborted)}`);
};

export async function runCatchUp(ports: GitPorts, base: ResolvedBase): Promise<CatchUpOutcome> {
  const ref = base.statusBase;
  if (base.mode === "origin") await must(ports, fetchBaseArgs(base.githubBase), `git fetch origin ${base.githubBase}`);
  if ((await ports.run(mergeInProgressArgs())).code === 0) throw new Error("The tree has an unfinished merge: conclude or abort it before catching up with the base.");
  const dirty = (await must(ports, trackedChangesArgs(), "git status")).trim() !== "";
  const [behind, ahead] = dirty ? [0, 0] : [await count(ports, behindCountArgs(ref)), await count(ports, aheadCountArgs(ref))];
  const action = decideCatchUp({ dirty, behind, ahead });
  if (action === "dirty") throw new Error("The branch has uncommitted changes: commit them before catching up with the base.");
  if (action === "up-to-date") return "up-to-date";
  if (action === "fast-forward") {
    await must(ports, fastForwardArgs(ref), `could not fast-forward to ${ref}`);
    return "fast-forwarded";
  }
  const merged = await ports.run(mergeBaseArgs(ref));
  if (merged.code === 0) return "merged";
  throw await failedMerge(ports, ref, merged);
}
