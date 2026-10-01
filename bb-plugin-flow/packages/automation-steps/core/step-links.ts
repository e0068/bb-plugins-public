// Layer 1 — the links a step leaves behind: the pull request it opened or
// merged, the task files it moved. Flow gathers them into the results of the
// automation stage, so the owner reaches the PR or the task from the stage
// itself instead of the agent naming them in every brief.

import type { RepoRef } from "./github-requests";
import type { StepLink, StepOutcome } from "./step-outcomes";

/** The pull request by its number, at the address GitHub gave it or `pullUrl` built. */
export const pullLink = (number: number, url: string): StepLink => ({ label: `PR #${number}`, target: url });

export const pullUrl = (repo: RepoRef, number: number): string => `https://github.com/${repo.owner}/${repo.repo}/pull/${number}`;

/** The answer of opening a PR: the step's own line of success and a link to the PR, opened now or found open. */
export const openedPullOutcome = (pull: { url: string; number: number }, detail: string): StepOutcome =>
  withLinks({ ok: true, detail }, [pullLink(pull.number, pull.url)]);

/** The merged PR, when GitHub named it; `null` — the merge went without asking GitHub, and there is nothing to link. */
export const mergedPullLinks = (pull: { repo: RepoRef; number: number } | null): StepLink[] => (pull === null ? [] : [pullLink(pull.number, pullUrl(pull.repo, pull.number))]);

/**
 * The task's file in `done/`, by the path from the root of the thread's tree — where a closed task lies on a board
 * with the default tasks folder `docs/tasks`, the one Flow reads task results by. A board with another folder gets
 * a link that does not open.
 */
export const taskLink = (task: { key: string; slug: string }): StepLink => ({ label: task.key, target: `docs/tasks/done/${task.slug}.md` });

/** A success with its links; a step without links, and a failure, answer as before — without the field. */
export const withLinks = (outcome: StepOutcome, links: readonly StepLink[]): StepOutcome =>
  outcome.ok && links.length > 0 ? { ...outcome, links: [...links] } : outcome;
