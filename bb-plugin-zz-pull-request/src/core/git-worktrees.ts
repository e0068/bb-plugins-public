// Слой 1 — разбор `git worktree list --porcelain` и поиск, в каком worktree
// сейчас зачекаучена базовая ветка. Ноль эффектов.
//
// Формат porcelain — блоки строк на каждый worktree, разделённые пустой
// строкой: `worktree <path>`, `HEAD <sha>`, затем `branch <ref>` (обычная
// ветка) либо `detached`/`bare` (без ветки). Нужна только пара path↔branch.

export interface GitWorktree {
  path: string;
  /** `null` — detached HEAD, bare-репозиторий или неопределимо. */
  branch: string | null;
}

const WORKTREE_PREFIX = "worktree ";
const BRANCH_PREFIX = "branch ";
const BRANCH_REF_PREFIX = "refs/heads/";

export function parseWorktreeList(output: string): readonly GitWorktree[] {
  const worktrees: GitWorktree[] = [];
  let path: string | null = null;
  let branch: string | null = null;
  const flush = () => {
    if (path !== null) worktrees.push({ path, branch });
    path = null;
    branch = null;
  };
  for (const line of output.split("\n")) {
    if (line === "") {
      flush();
    } else if (line.startsWith(WORKTREE_PREFIX)) {
      path = line.slice(WORKTREE_PREFIX.length);
    } else if (line.startsWith(BRANCH_PREFIX)) {
      branch = line.slice(BRANCH_PREFIX.length);
    }
  }
  flush();
  return worktrees;
}

/** Путь worktree, где сейчас зачекаучена `<base>`, либо `null`, если нигде. */
export function findBaseCheckout(
  worktrees: readonly GitWorktree[],
  base: string,
): string | null {
  const target = `${BRANCH_REF_PREFIX}${base}`;
  return worktrees.find((worktree) => worktree.branch === target)?.path ?? null;
}
