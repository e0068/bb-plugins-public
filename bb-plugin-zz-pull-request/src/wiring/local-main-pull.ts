// Слой 3 (оболочка) — best-effort подтяжка локального `main` после мёржа PR.
//
// `<base>` почти всегда зачекаучена ГДЕ-ТО в общем репозитории — обычно в
// интеграционной копии, отдельной от рабочей копии окружения (env.path), в
// которой запущен сам плагин (см. AGENTS.md, «Параллельные сессии»). Прямой
// `git fetch origin <base>:<base>` из env.path на это натыкается: git
// корректно ОТКАЗЫВАЕТСЯ обновлять ветку, зачекаученную в другом worktree —
// но раньше плагин на этом и останавливался, хотя обновить её ВСЁ ЖЕ можно:
// штатным `fetch`+`merge --ff-only`, выполненным ПРЯМО в той рабочей копии
// (`git -C <path> ...`) — это то же самое, что сделал бы человек руками. См.
// memory/decisions/local-main-pull-targets-actual-checkout.md.
//
// Поэтому сначала спрашиваем `git worktree list --porcelain` (дёшево,
// read-only, не имеет значения, откуда запущено — worktree общие для всего
// репозитория) и ищем, в каком worktree сейчас зачекаучена `<base>`:
// - нашли → `fetch`+`merge --ff-only` там же (`-C <path>`);
// - нигде не зачекаучена → прежний прямой путь, `fetch origin <base>:<base>`.
// В обоих случаях `--ff-only`/рефспек без `+` не дают неfast-forward
// обновление — гарантия от git, не от плагина. Отказ — ожидаемый штатный
// исход (разошлись, или в целевой копии несохранённые правки), не дефект:
// результат — Result, не throw.
import { findBaseCheckout, parseWorktreeList } from "../core/git-worktrees";
import {
  fastForwardAtArgs,
  fetchBaseAtArgs,
  fetchIntoLocalBranchArgs,
  worktreeListArgs,
} from "../core/git-commands";
import { gitRunMessage, type GitPorts, type GitRun } from "./git-run";

export type LocalMainPullResult = { ok: true } | { ok: false; reason: string };

export async function runLocalMainPull(
  ports: GitPorts,
  base: string,
): Promise<LocalMainPullResult> {
  const checkoutPath = await findBaseCheckoutPath(ports, base);
  return checkoutPath
    ? pullAtCheckout(ports, checkoutPath, base)
    : pullDirectlyIntoRef(ports, base);
}

async function findBaseCheckoutPath(ports: GitPorts, base: string): Promise<string | null> {
  const listed = await ports.run(worktreeListArgs());
  if (listed.code !== 0) return null;
  return findBaseCheckout(parseWorktreeList(listed.stdout), base);
}

async function pullDirectlyIntoRef(ports: GitPorts, base: string): Promise<LocalMainPullResult> {
  const fetched = await ports.run(fetchIntoLocalBranchArgs(base));
  return toResult(fetched);
}

async function pullAtCheckout(
  ports: GitPorts,
  path: string,
  base: string,
): Promise<LocalMainPullResult> {
  const fetched = await ports.run(fetchBaseAtArgs(path, base));
  if (fetched.code !== 0) return toResult(fetched);
  const merged = await ports.run(fastForwardAtArgs(path, base));
  return toResult(merged);
}

function toResult(run: GitRun): LocalMainPullResult {
  return run.code === 0 ? { ok: true } : { ok: false, reason: gitRunMessage(run) };
}
