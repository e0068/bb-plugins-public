// Слой 1 — решение, показывать ли кнопку «Pull Request». Ноль эффектов.
//
// Кнопка нужна ровно в одном состоянии: всё закоммичено, есть коммиты впереди
// базовой ветки, и ОТКРЫТОГО PR по этой ветке ещё нет. Любое иное состояние
// прячет кнопку — её роль только «создать».
//
// Завершённый PR (merged/закрыт) кнопку НЕ блокирует: после слияния и нового
// коммита ветка снова уходит вперёд базы, и на этот коммит можно открыть новый
// PR. Блокирует только живой (open/draft) PR — чтобы не плодить дубли.

/**
 * Что bb знает про PR этой ветки:
 * - `absent` — реальный ответ «PR нет»;
 * - `open` — есть незакрытый PR (open/draft) → кнопку блокирует;
 * - `settled` — PR слит или закрыт → кнопку НЕ блокирует, можно открыть новый;
 * - `unknown` — узнать не удалось (нет gh/авторизации/таймаут) → блокирует,
 *   создавать вслепую нельзя, иначе рискуем открыть второй PR.
 */
export type PrPresence = "absent" | "open" | "settled" | "unknown";

export interface VisibilityInput {
  hasUncommittedChanges: boolean;
  aheadCount: number;
  pr: PrPresence;
}

/** Причина скрыта наружу — по ней фронт может подсказать пользователю. */
export type VisibilityReason =
  | "ready"
  | "dirty"
  | "nothing-to-pr"
  | "pr-exists"
  | "pr-unknown";

export interface VisibilityDecision {
  visible: boolean;
  reason: VisibilityReason;
}

export function decideVisibility(input: VisibilityInput): VisibilityDecision {
  // Живой PR уже открыт — кнопки нет (не плодим дубли).
  if (input.pr === "open") return { visible: false, reason: "pr-exists" };
  // Не смогли узнать про PR — создавать вслепую нельзя; прячем.
  if (input.pr === "unknown") return { visible: false, reason: "pr-unknown" };
  // absent | settled — PR открыть можно; дальше решают правки и коммиты.
  // Есть несохранённые правки — сперва коммит (кнопка Commit ядра bb).
  if (input.hasUncommittedChanges) return { visible: false, reason: "dirty" };
  // Нечего пиарить — ветка не ушла вперёд базовой.
  if (input.aheadCount <= 0) return { visible: false, reason: "nothing-to-pr" };
  return { visible: true, reason: "ready" };
}
