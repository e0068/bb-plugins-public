// Layer 1 — где работает тред: своё дерево или чекаут проекта, и нужна ли ему
// своя ветка перед коммитом. Ни одного эффекта.
import { stripOriginPrefix } from "./base-branch";

/** Окружение треда глазами git: что bb знает о его дереве и ветках. */
export interface GitPlace {
  readonly isGitRepo: boolean;
  readonly isWorktree: boolean;
  readonly managed: boolean;
  readonly branchName: string | null;
  readonly defaultBranch: string | null;
}

/**
 * - `not-started` — окружения ещё нет: дерево выберет Flow до первого хода;
 * - `own-tree` — worktree, заведённый bb под тред;
 * - `project-checkout` — папка самого проекта, общая с владельцем и соседними тредами;
 * - `no-git` — папка без git.
 */
export type TreePlace = "not-started" | "own-tree" | "project-checkout" | "no-git";

export const treePlaceOf = (place: GitPlace | null): TreePlace => {
  if (place === null) return "not-started";
  if (!place.isGitRepo) return "no-git";
  return place.isWorktree || place.managed ? "own-tree" : "project-checkout";
};

/** Ветка, которую шаг отводит перед коммитом, когда тред стоит на ветке по умолчанию; `null` — коммитить в текущую. */
export const branchOffName = ({ branchName, defaultBranch }: GitPlace, threadId: string): string | null =>
  branchName !== null && defaultBranch !== null && branchName === stripOriginPrefix(defaultBranch) ? `bb/flow-${threadId}` : null;
