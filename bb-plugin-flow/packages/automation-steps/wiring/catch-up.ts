// Layer 3 (shell), the testable part — orchestrates catching the branch up with the tip of its base:
// fetch (mode "origin") → tracked changes → live behind/ahead → up-to-date,
// fast-forward or merge. A conflicted merge is aborted whole and reported with
// its files, so the tree is never left half-merged. The decision is
// core/catch-up.ts; the process is git-client.ts behind GitPorts.
import type { ResolvedBase } from "../core/base-branch";
import { conflictedFilesArgs, currentBranchArgs, decideCatchUp, IN_PROGRESS_REFS, inProgressArgs, mergeAbortArgs, mergeBaseArgs, resetToBaseArgs, trackedChangesArgs } from "../core/catch-up";
import { aheadCountArgs, behindCountArgs, fastForwardArgs, fetchBaseArgs, replayAbortArgs, replayOntoArgs } from "../core/git-commands";
import { findMergedCutoff } from "./merged-cutoff";
import { checkMergedContent } from "./merged-content";
import { gitRunMessage, type GitPorts, type GitRun } from "./git-run";

export type CatchUpOutcome = "up-to-date" | "fast-forwarded" | "merged" | "reset-to-base" | "replay-onto-base";

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
 * A failed merge or replay: git refused before starting — its own text and
 * nothing undone, because nothing was started; conflicts — undo the whole
 * thing and name the files, or say the tree is left mid-operation.
 *
 * The file names come FIRST. The step's error is shown on one line in the
 * flow's progress bar, and that line is cut to the width of the panel: a
 * message that opens with "Merging origin/main into the branch has
 * conflicts…" spends the visible part on words the owner already knows and
 * cuts away the only thing they need — which files to go and resolve.
 *
 * One function for both, because the two differ in three words: a copy of it
 * per operation is exactly how the undo and the check for conflicts drifted
 * apart once already.
 */
const failedCatchUp = async (
  ports: GitPorts,
  ref: string,
  failed: GitRun,
  texts: { abort: readonly string[]; refused: string; undone: string; undoFailed: string },
): Promise<Error> => {
  const conflicts = (await ports.run(conflictedFilesArgs())).stdout.split("\n").map((f) => f.trim()).filter((f) => f !== "");
  // Git отказался начать — начатого нет, и отменять нечего: отмена здесь унесла
  // бы чужую незаконченную операцию вместе с работой владельца.
  if (conflicts.length === 0) return new Error(`${texts.refused}: ${gitRunMessage(failed)}`);
  const aborted = await ports.run(texts.abort);
  const named = conflicts.join(", ");
  return aborted.code === 0
    ? new Error(`${named} — conflicts with ${ref}. ${texts.undone}`)
    : new Error(`${named} — conflicts with ${ref}, and ${texts.undoFailed}: ${gitRunMessage(aborted)}`);
};

const failedMerge = (ports: GitPorts, ref: string, merged: GitRun): Promise<Error> =>
  failedCatchUp(ports, ref, merged, {
    abort: mergeAbortArgs(),
    refused: `could not merge ${ref}`,
    undone: "The merge was aborted, the branch is untouched: resolve them in the working copy, commit the merge, and run the step again.",
    undoFailed: "git merge --abort failed too, so the tree is left mid-merge",
  });

const failedReplay = (ports: GitPorts, ref: string, replayed: GitRun): Promise<Error> =>
  failedCatchUp(ports, ref, replayed, {
    abort: replayAbortArgs(),
    refused: `could not bring the branch's own work onto ${ref}`,
    undone: "The branch's own work was not moved onto the base, the branch is untouched: resolve them in the working copy and run the step again.",
    undoFailed: "git rebase --abort failed too, so the tree is left mid-rebase",
  });

/**
 * Почему в этом дереве работать нельзя: незаконченная операция — слияние,
 * остановленный rebase, cherry-pick, revert — или отделённый HEAD. Второе
 * ловит rebase, остановленный на `break` или упавшем `exec`: он не оставляет
 * ни одной псевдоссылки, а ветки под шагом всё равно нет.
 */
const refuseReason = async (ports: GitPorts): Promise<string | null> => {
  for (const { ref, what } of IN_PROGRESS_REFS) {
    if ((await ports.run(inProgressArgs(ref))).code === 0) {
      return `The tree has an unfinished ${what}: conclude or abort it before catching up with the base.`;
    }
  }
  if ((await ports.run(currentBranchArgs())).code === 0) return null;
  return "The working copy is not on a branch — a detached HEAD, or a rebase paused mid-way: put it back on its branch before catching up with the base.";
};

export async function runCatchUp(ports: GitPorts, base: ResolvedBase): Promise<CatchUpOutcome> {
  const ref = base.statusBase;
  if (base.mode === "origin") await must(ports, fetchBaseArgs(base.githubBase), `git fetch origin ${base.githubBase}`);
  const refused = await refuseReason(ports);
  if (refused !== null) throw new Error(refused);
  const dirty = (await must(ports, trackedChangesArgs(), "git status")).trim() !== "";
  const [behind, ahead] = dirty ? [0, 0] : [await count(ports, behindCountArgs(ref)), await count(ports, aheadCountArgs(ref))];
  // Содержимое меряется только там, где от него зависит решение: ветка и
  // отстаёт, и впереди. Fetch к этому моменту уже сделан — измерению остаётся
  // одно слияние в памяти.
  const diverged = !dirty && behind > 0 && ahead > 0;
  const mergedContent = diverged ? await checkMergedContent(ports, base, { fetched: base.mode === "origin" }) : undefined;
  // Ветка разошлась, но влита не целиком — значит, после мёрджа она успела
  // поработать. Ищем срез: до него содержимое уже в базе, после него — новая
  // работа, и только её и надо переносить.
  const mergedCutoff = mergedContent === "not-merged" ? await findMergedCutoff(ports, base) : null;
  const action = decideCatchUp({ dirty, behind, ahead, mergedContent, mergedCutoff });
  if (action === "dirty") throw new Error("The branch has uncommitted changes: commit them before catching up with the base.");
  if (action === "up-to-date") return "up-to-date";
  if (action === "fast-forward") {
    await must(ports, fastForwardArgs(ref), `could not fast-forward to ${ref}`);
    return "fast-forwarded";
  }
  if (action === "reset-to-base") {
    await must(ports, resetToBaseArgs(ref), `could not bring the branch onto ${ref}`);
    return "reset-to-base";
  }
  if (action === "replay-onto-base" && mergedCutoff !== null) {
    const replayed = await ports.run(replayOntoArgs(ref, mergedCutoff));
    if (replayed.code === 0) return "replay-onto-base";
    throw await failedReplay(ports, ref, replayed);
  }
  const merged = await ports.run(mergeBaseArgs(ref));
  if (merged.code === 0) return "merged";
  throw await failedMerge(ports, ref, merged);
}
