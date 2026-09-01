// Слой 1 — чистые построители argv для git-команд перемотки. Ноль эффектов.
//
// Перемотка на удалённую базу — три шага: обновить ремоут-реф (`fetch`),
// живьём перепроверить `ahead` («aheadCountArgs») и только потом сдвинуть
// текущую ветку строго вперёд (`merge --ff-only`). `--ff-only` — гарант
// безопасности: если это не перемотка (ветки разошлись), git откажет, а не
// сольёт коммитом; живая проверка нужна, чтобы отказать читаемым текстом
// плагина раньше, чем это сделает сырой git — см.
// memory/tasks/in_progress/fast-forward-stale-ahead-status.md. Здесь только
// тела команд; их запуск и cwd — в оболочке.

/** `git fetch origin <base>` — подтянуть свежий `origin/<base>` перед перемоткой. */
export function fetchBaseArgs(base: string): readonly string[] {
  return ["fetch", "origin", base];
}

/** `git rev-list --count origin/<base>..HEAD` — живых коммитов ветки впереди базы. */
export function aheadCountArgs(base: string): readonly string[] {
  return ["rev-list", "--count", `origin/${base}..HEAD`];
}

/** `git merge --ff-only origin/<base>` — сдвинуть ветку вперёд к базе или отказать. */
export function fastForwardArgs(base: string): readonly string[] {
  return ["merge", "--ff-only", `origin/${base}`];
}

// `<src>:<dst>` без ведущего `+` — рефспек, который САМ git не даёт применить
// не-fast-forward и не даёт обновить ветку, зачекаученную в любом worktree
// репозитория. Годится, только когда `<base>` нигде не зачекаучена — иначе
// см. fetchBaseAtArgs/fastForwardAtArgs ниже (см.
// memory/decisions/local-main-pull-targets-actual-checkout.md).
/** `git fetch origin <base>:<base>` — подтянуть origin/<base> прямо в локальный реф `<base>`. */
export function fetchIntoLocalBranchArgs(base: string): readonly string[] {
  return ["fetch", "origin", `${base}:${base}`];
}

/** `git worktree list --porcelain` — перечислить все worktree общего репозитория. */
export function worktreeListArgs(): readonly string[] {
  return ["worktree", "list", "--porcelain"];
}

// `-C <path>` заставляет git выполнить команду так, будто это его cwd —
// не имеет значения, откуда реально запущен процесс. Так `<base>`
// обновляется штатным `fetch` + `merge --ff-only` ПРЯМО в той рабочей копии,
// где она зачекаучена (обычно интеграционная копия, см. AGENTS.md), а не
// подвигается извне, где git такое запрещает.
/** `git -C <path> fetch origin <base>` — подтянуть origin/<base> в указанном worktree. */
export function fetchBaseAtArgs(path: string, base: string): readonly string[] {
  return ["-C", path, ...fetchBaseArgs(base)];
}

/** `git -C <path> merge --ff-only origin/<base>` — перемотать ветку, зачекаученную в `<path>`. */
export function fastForwardAtArgs(path: string, base: string): readonly string[] {
  return ["-C", path, ...fastForwardArgs(base)];
}
