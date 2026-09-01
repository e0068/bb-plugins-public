// Слой 1 — чистые построители argv для git-команд перемотки. Ноль эффектов.
//
// Перемотка на удалённую базу — два шага: обновить ремоут-реф (`fetch`), затем
// сдвинуть текущую ветку строго вперёд (`merge --ff-only`). `--ff-only` — гарант
// безопасности: если это не перемотка (ветки разошлись), git откажет, а не
// сольёт коммитом. Здесь только тела команд; их запуск и cwd — в оболочке.

/** `git fetch origin <base>` — подтянуть свежий `origin/<base>` перед перемоткой. */
export function fetchBaseArgs(base: string): readonly string[] {
  return ["fetch", "origin", base];
}

/** `git merge --ff-only origin/<base>` — сдвинуть ветку вперёд к базе или отказать. */
export function fastForwardArgs(base: string): readonly string[] {
  return ["merge", "--ff-only", `origin/${base}`];
}
