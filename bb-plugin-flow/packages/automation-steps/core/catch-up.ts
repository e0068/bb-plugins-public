// Layer 1 — how to catch a branch up with the tip of its base. Zero effects.
//
// The step pulls in the CURRENT tip of the base the branch was forked from and
// its PR targets: the fork point itself is already in the branch, merging it
// would change nothing. A branch that isn't behind has nothing to do, even
// with commits of its own. Behind with no commits of its own — a plain
// fast-forward. Behind with commits of its own — a regular merge of the base
// into the branch: history isn't rewritten, so an open PR stays intact.
// Uncommitted tracked changes or an unfinished merge refuse up front: a merge
// would run into them, and aborting would throw away someone else's merge.
//
// The one branch that looks diverged and isn't: the one whose PR has already
// been merged. The plugin opens PRs through the API without a push, so what
// lands in the base is a commit the local branch never had — the branch stays
// off the base's ancestry forever, and the merge above sees its OWN changes
// coming back "from the other side". Everything the branch touched again
// after the merge then conflicts with itself. Measured content says so
// (core/merged-content.ts): the branch adds nothing to the base, so it is
// brought straight onto the base instead of being merged with it.

import type { MergedContent } from "./merged-content";

export type CatchUpInput = {
  behind: number;
  ahead: number;
  dirty: boolean;
  /** Измеренное «содержимое ветки уже в базе»; поля нет — не мерили, и это не повод считать ветку влитой. */
  mergedContent?: MergedContent;
  /** Самый свежий собственный коммит, чьё содержимое уже в базе: всё после него — новая работа ветки. `null` или поля нет — среза не нашли. */
  mergedCutoff?: string | null;
};

export type CatchUpAction = "dirty" | "up-to-date" | "fast-forward" | "merge" | "reset-to-base" | "replay-onto-base";

export const decideCatchUp = ({ behind, ahead, dirty, mergedContent, mergedCutoff }: CatchUpInput): CatchUpAction =>
  dirty
    ? "dirty"
    : behind === 0
      ? "up-to-date"
      : ahead === 0
        ? "fast-forward"
        : mergedContent === "merged"
          ? "reset-to-base"
          : typeof mergedCutoff === "string"
            ? "replay-onto-base"
            : "merge";

/** `git reset --hard <ref>` — ветка встаёт на базу; отслеживаемых правок к этому моменту нет, неотслеживаемые файлы остаются. */
export const resetToBaseArgs = (ref: string): readonly string[] => ["reset", "--hard", ref];

/** `git status --porcelain --untracked-files=no` — tracked changes only: untracked files don't block a merge. */
export const trackedChangesArgs = (): readonly string[] => ["status", "--porcelain", "--untracked-files=no"];

/**
 * Незаконченные операции в дереве, по их псевдоссылкам. Слияние здесь не одно:
 * остановленный rebase (`edit`, `break`, конфликт) оставляет чистое
 * `status --porcelain -uno` и никакого `MERGE_HEAD`, а следующий за ним
 * `rebase --onto` отказывается начать — и отмена, сделанная «на всякий случай»,
 * унесла бы вместе с собой правку владельца, ради которой rebase и был
 * остановлен. Поэтому шаг отказывается работать в дереве с любой из них.
 */
export const IN_PROGRESS_REFS: readonly { ref: string; what: string }[] = [
  { ref: "MERGE_HEAD", what: "merge" },
  { ref: "REBASE_HEAD", what: "rebase" },
  { ref: "CHERRY_PICK_HEAD", what: "cherry-pick" },
  { ref: "REVERT_HEAD", what: "revert" },
];

/** `git rev-parse -q --verify <ref>` — код 0, пока соответствующая операция идёт. */
export const inProgressArgs = (ref: string): readonly string[] => ["rev-parse", "-q", "--verify", ref];

/**
 * `git symbolic-ref -q --short HEAD` — имя ветки; ненулевой код значит, что
 * HEAD отделён. Это вторая половина сторожа: rebase, остановленный на `break`
 * или упавшем `exec`, не оставляет ни одной псевдоссылки выше, но HEAD при нём
 * отделён — и шаг, двигающий ветку, в такой копии работать не должен, ветки-то
 * под ним нет.
 */
export const currentBranchArgs = (): readonly string[] => ["symbolic-ref", "-q", "--short", "HEAD"];

/** `git merge --no-edit <ref>` — merge the base into the branch with git's default message. */
export const mergeBaseArgs = (ref: string): readonly string[] => ["merge", "--no-edit", ref];

/** `git diff --name-only --diff-filter=U` — files left unmerged by a conflicted merge. */
export const conflictedFilesArgs = (): readonly string[] => ["diff", "--name-only", "--diff-filter=U"];

/** `git merge-base --is-ancestor <ref> HEAD` — exits 0 when HEAD already contains `ref`. */
export const isAncestorArgs = (ref: string): readonly string[] => ["merge-base", "--is-ancestor", ref, "HEAD"];

/** `git merge --abort` — put the branch and the tree back as they were before the merge. */
export const mergeAbortArgs = (): readonly string[] => ["merge", "--abort"];

/** `git status --porcelain --untracked-files=no` за слиянием — коды конфликтов по файлам (core/conflict-merge.ts `parseUnmerged`). */
export const unmergedStatusArgs = (): readonly string[] => ["status", "--porcelain", "--untracked-files=no"];

/** `git show :<стадия>:<путь>` — копия файла в конфликте: 1 — общий предок, 2 — ветка, 3 — база. */
export const showStageArgs = (stage: 1 | 2 | 3, path: string): readonly string[] => ["show", `:${stage}:${path}`];

/** `git show <ref>:<путь>` — файл в коммите. */
export const showAtArgs = (ref: string, path: string): readonly string[] => ["show", `${ref}:${path}`];

/** `git ls-files -- docs/tasks/*\/<слаг>.md` — копии задачи по всем папкам в индексе. */
export const taskCopiesArgs = (slug: string): readonly string[] => ["ls-files", "--", `docs/tasks/*/${slug}.md`];

/** `git ls-files -- <путь>` — есть ли путь в индексе: пусто — нет. */
export const trackedPathArgs = (path: string): readonly string[] => ["ls-files", "--", path];

/** `git add -- <пути>` — сведённые файлы в индекс. */
export const addPathsArgs = (paths: readonly string[]): readonly string[] => ["add", "--", ...paths];

/** `git rm -q --cached --ignore-unmatch -- <пути>` — снять путь из индекса; файл дерева снимает тот, кто его пишет. */
export const unstagePathsArgs = (paths: readonly string[]): readonly string[] => ["rm", "-q", "--cached", "--ignore-unmatch", "--", ...paths];

/** `git commit --no-edit` — закоммитить сведённое слияние с сообщением git. */
export const commitMergeArgs = (): readonly string[] => ["commit", "--no-edit"];
