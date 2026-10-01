// Layer 3 (shell), the testable part — orchestrates catching the branch up with the tip of its base:
// fetch (mode "origin") → tracked changes → live behind/ahead → up-to-date,
// fast-forward or merge. A conflicted merge is aborted whole and reported with
// its files, so the tree is never left half-merged. The decision is
// core/catch-up.ts; the process is git-client.ts behind GitPorts.
import type { ResolvedBase } from "../core/base-branch";
import type { ParentDelivery } from "../core/parent-delivery";
import { commitMergeArgs, conflictedFilesArgs, currentBranchArgs, decideCatchUp, IN_PROGRESS_REFS, inProgressArgs, isAncestorArgs, mergeAbortArgs, mergeBaseArgs, resetToBaseArgs, trackedChangesArgs, unmergedStatusArgs } from "../core/catch-up";
import { conflictClass, parseUnmerged } from "../core/conflict-merge";
import { aheadCountArgs, behindCountArgs, fastForwardArgs, fetchBaseArgs, replayAbortArgs, replayOntoArgs } from "../core/git-commands";
import { findMergedCutoff } from "./merged-cutoff";
import { checkMergedContent } from "./merged-content";
import { resolveConflict } from "./conflict-resolve";
import { gitRunMessage, type GitPorts, type GitRun } from "./git-run";
import type { TreeFiles } from "./tree-files";

export type CatchUpOutcome = "up-to-date" | "fast-forwarded" | "merged" | "reset-to-base" | "replay-onto-base";

/**
 * Конфликт слияния базы в ветку, который шаг сам не свёл, — работа агента треда:
 * `files` — все файлы в конфликте, `base` — ветка, с которой они конфликтуют;
 * текст — тот же, что у отменённого слияния. Слияние к этому моменту отменено.
 */
export class CatchUpConflict extends Error {
  constructor(
    message: string,
    readonly files: readonly string[],
    readonly base: string,
  ) {
    super(message);
    this.name = "CatchUpConflict";
  }
}

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
  texts: { abort: readonly string[]; refused: string; undone: string; undoFailed: string; agentWork: boolean },
): Promise<Error> => {
  const conflicts = (await ports.run(conflictedFilesArgs())).stdout.split("\n").map((f) => f.trim()).filter((f) => f !== "");
  // Git отказался начать — начатого нет, и отменять нечего: отмена здесь унесла
  // бы чужую незаконченную операцию вместе с работой владельца.
  if (conflicts.length === 0) return new Error(`${texts.refused}: ${gitRunMessage(failed)}`);
  const aborted = await ports.run(texts.abort);
  const named = conflicts.join(", ");
  return aborted.code === 0
    ? conflictError(`${named} — conflicts with ${ref}. ${texts.undone}`, conflicts, ref, texts.agentWork)
    : new Error(`${named} — conflicts with ${ref}, and ${texts.undoFailed}: ${gitRunMessage(aborted)}`);
};

/** Конфликт догоняния — агенту; доставка в родителя и перенос ветки на базу — обычная ошибка: сводить их агенту ветки нечего. */
const conflictError = (message: string, files: readonly string[], ref: string, agentWork: boolean): Error => (agentWork ? new CatchUpConflict(message, files, ref) : new Error(message));

const MERGE_UNDONE = "The merge was aborted, the branch is untouched: resolve them in the working copy, commit the merge, and run the step again.";

const failedMerge = (ports: GitPorts, ref: string, merged: GitRun, agentWork: boolean): Promise<Error> =>
  failedCatchUp(ports, ref, merged, {
    agentWork,
    abort: mergeAbortArgs(),
    refused: `could not merge ${ref}`,
    undone: MERGE_UNDONE,
    undoFailed: "git merge --abort failed too, so the tree is left mid-merge",
  });

const failedReplay = (ports: GitPorts, ref: string, replayed: GitRun): Promise<Error> =>
  failedCatchUp(ports, ref, replayed, {
    agentWork: false,
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
const refuseReason = async (ports: GitPorts, before: string): Promise<string | null> => {
  for (const { ref, what } of IN_PROGRESS_REFS) {
    if ((await ports.run(inProgressArgs(ref))).code === 0) {
      return `The tree has an unfinished ${what}: conclude or abort it before ${before}.`;
    }
  }
  if ((await ports.run(currentBranchArgs())).code === 0) return null;
  return `The working copy is not on a branch — a detached HEAD, or a rebase paused mid-way: put it back on its branch before ${before}.`;
};

/**
 * Конфликты слияния, которые шаг сводит сам: только файлы задач и пункты
 * ченж-лога. Хоть один другой — `false`, ничего не тронуто, и слияние отменяет
 * вызывающий; всё свелось — слияние закоммичено, `true`. Сведение сорвалось
 * на полпути — файл не свёлся, запись упала, хук отклонил коммит — слияние
 * отменяется здесь же, а конфликт уходит агенту с исходным списком файлов:
 * сведённые к этому моменту из списка git уже выпали бы.
 */
const resolveKnown = async (ports: GitPorts, files: TreeFiles, ref: string): Promise<boolean> => {
  const conflicts = parseUnmerged((await ports.run(unmergedStatusArgs())).stdout);
  const known = conflicts.map((conflict) => ({ conflict, kind: conflictClass(conflict.path) }));
  if (known.length === 0 || known.some(({ kind }) => kind === "other")) return false;
  const settle = async (): Promise<string | null> => {
    for (const { conflict, kind } of known) if (kind !== "other" && !(await resolveConflict(ports, files, conflict, kind))) return `${conflict.path} did not settle`;
    const committed = await ports.run(commitMergeArgs());
    return committed.code === 0 ? null : `the merge commit was refused: ${gitRunMessage(committed)}`;
  };
  const problem = await settle().catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
  if (problem === null) return true;
  const named = known.map(({ conflict }) => conflict.path);
  const aborted = await ports.run(mergeAbortArgs());
  // Отмена не прошла — дерево посреди слияния: будить агента над ним нельзя, это ждёт владельца.
  if (aborted.code !== 0) throw new Error(`${named.join(", ")} — conflicts with ${ref}, settling them failed (${problem}), and git merge --abort failed too, so the tree is left mid-merge: ${gitRunMessage(aborted)}`);
  throw new CatchUpConflict(`${named.join(", ")} — conflicts with ${ref}, and settling them failed (${problem}). ${MERGE_UNDONE}`, named, ref);
};

/** `files` — дерево ветки для сведения файлов задач и пунктов ченж-лога; без него любой конфликт отменяет слияние, как раньше. */
export async function runCatchUp(ports: GitPorts, base: ResolvedBase, files?: TreeFiles): Promise<CatchUpOutcome> {
  const ref = base.statusBase;
  if (base.mode === "origin") await must(ports, fetchBaseArgs(base.githubBase), `git fetch origin ${base.githubBase}`);
  const refused = await refuseReason(ports, "catching up with the base");
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
  if (files !== undefined && (await resolveKnown(ports, files, ref))) return "merged";
  throw await failedMerge(ports, ref, merged, true);
}

/** What delivering a child thread's branch into its parent's working copy did. */
export type ParentDeliveryOutcome = "already-in" | "delivered";

/**
 * Merge a child thread's branch into the parent thread's working copy at
 * `ports` (core/parent-delivery.ts). A branch already contained is the goal
 * reached, so a repeated step answers success instead of a second merge. The
 * parent's tree is someone else's work in progress: an unfinished operation
 * there is refused, not aborted; a tree switched to another branch than the
 * one bb knows is refused too, since the merge would land there; a conflicted
 * merge is undone whole, the same way catching up undoes it.
 */
export async function runParentDelivery(
  ports: GitPorts,
  { branch, parentBranch }: Pick<ParentDelivery, "branch" | "parentBranch">,
): Promise<ParentDeliveryOutcome> {
  const refused = await refuseReason(ports, `merging ${branch} into it`);
  if (refused !== null) throw new Error(refused);
  const current = (await ports.run(currentBranchArgs())).stdout.trim();
  if (current !== parentBranch) {
    throw new Error(`The parent thread's working copy is on ${current}, not on its branch ${parentBranch}: switch it back before merging ${branch} into it.`);
  }
  if ((await ports.run(isAncestorArgs(branch))).code === 0) return "already-in";
  const merged = await ports.run(mergeBaseArgs(branch));
  if (merged.code === 0) return "delivered";
  throw await failedMerge(ports, branch, merged, false);
}
