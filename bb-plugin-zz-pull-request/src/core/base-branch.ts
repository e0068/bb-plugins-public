// Слой 1 — выбор базовой ветки окружения. Ноль эффектов.
//
// База нужна в двух формах, и их нельзя путать:
// - statusBase — против чего считать merge-base и aheadCount. Берём УДАЛЁННУЮ
//   ветку `origin/<x>`, как это делает сама панель bb. Локальный `main` в
//   worktree бывает устаревшим (позади origin/main): сравнение против него даёт
//   фантомные «коммиты впереди», и кнопка висит даже на диффе 0.
// - githubBase — голое имя ветки для GitHub API (getBranch) и поля base
//   пул-реквеста; там префикс `origin/` недопустим.
//
// Поля окружения приходят в трёх формах с разным смыслом: mergeBaseBranch (явный
// override базы, имя), defaultBranch (имя ветки по умолчанию), baseBranch (иногда
// ремоут-реф вида `origin/main`).

export interface EnvBranches {
  mergeBaseBranch: string | null;
  defaultBranch: string | null;
  baseBranch: string | null;
}

export interface ResolvedBase {
  /** Ремоут-реф для merge-base/aheadCount — как считает сам bb. */
  statusBase: string;
  /** Голое имя ветки для GitHub API и base пул-реквеста. */
  githubBase: string;
}

export function resolveBase(env: EnvBranches): ResolvedBase | null {
  const raw = env.mergeBaseBranch ?? env.defaultBranch ?? env.baseBranch;
  if (!raw) return null;
  const githubBase = stripOriginPrefix(raw);
  const statusBase = raw.startsWith("origin/") ? raw : `origin/${githubBase}`;
  return { statusBase, githubBase };
}

/** `origin/main` → `main`; прочие имена не трогаем (ветка сама может быть с «/»). */
function stripOriginPrefix(branch: string): string {
  return branch.startsWith("origin/") ? branch.slice("origin/".length) : branch;
}
