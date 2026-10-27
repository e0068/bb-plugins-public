// Layer 1 — reads git's answer to "is the thread's code already in the base?"
// and words the refusal of the step «Задача → done». Zero effects.
//
// The commit comes first: when `HEAD` is in the base's history the code is in,
// whatever the merge looked like. A merge commit keeps the branch's commits as
// a parent, so that is the usual answer here. The content (core/merged-content.ts)
// is the second opinion, asked only when the commit is not there: a squash and
// a PR built through the API put a differently-SHA'd commit into the base.

import type { CommandOutcome } from "./command-outcome";

/**
 * - `in-main` — the code is in the base, by commit or by content;
 * - `not-in-main` — the branch still carries work the base lacks;
 * - `unknown` — git gave no usable answer (no network, a broken repository).
 */
export type BranchInMain = "in-main" | "not-in-main" | "unknown";

/** What `merge-base --is-ancestor` said. */
export type Ancestry = "ancestor" | "not-ancestor" | "unknown";

/** `git merge-base --is-ancestor HEAD <ref>` — exit 0 when the branch's commit is in the history of the base ref. */
export function headInBaseArgs(ref: string): readonly string[] {
  return ["merge-base", "--is-ancestor", "HEAD", ref];
}

// Exit 1 is the answer "not an ancestor"; anything else is git itself failing.
const NOT_ANCESTOR_CODE = 1;

export function decideAncestry(outcome: CommandOutcome): Ancestry {
  if (outcome.code === 0) return "ancestor";
  return outcome.code === NOT_ANCESTOR_CODE ? "not-ancestor" : "unknown";
}

/** Why the step leaves the tasks where they are: the line the step goes red with, and the comment the task gets. */
export interface DoneHold {
  readonly reason: string;
  readonly comment: string;
}

export function doneHold(verdict: Exclude<BranchInMain, "in-main">, base: string): DoneHold {
  return verdict === "not-in-main"
    ? {
        reason: `the thread's code is not in ${base} yet`,
        comment: `Задача не закрыта: кода ветки треда ещё нет в ${base}. Шаг «Задача → done» переведёт её, когда ветка будет влита.`,
      }
    : {
        reason: `could not check whether the thread's code is in ${base}`,
        comment: `Задача не закрыта: не удалось проверить, есть ли код ветки треда в ${base} (git не ответил). Повторите шаг «Задача → done».`,
      };
}
