// Слой 1 — решение, показывать ли кнопку «Pull Request». Ноль эффектов.
//
// Кнопка нужна ровно в одном состоянии: всё закоммичено, есть коммиты впереди
// базовой ветки, и PR ещё не открыт. Любое иное состояние прячет кнопку — её
// роль только «создать», статус готового PR виден в штатном месте bb.

/** Как bb ответил на запрос PR: реальный ответ «нет» — это `absent`. */
export type PrLookupOutcome = "absent" | "available" | "unavailable";

export interface VisibilityInput {
  hasUncommittedChanges: boolean;
  aheadCount: number;
  pr: PrLookupOutcome;
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
  // PR уже открыт — кнопки нет (не плодим дубли).
  if (input.pr === "available") return { visible: false, reason: "pr-exists" };
  // Не смогли узнать про PR (нет gh/авторизации/таймаут) — создавать вслепую
  // нельзя, иначе рискуем открыть второй PR; прячем.
  if (input.pr === "unavailable") return { visible: false, reason: "pr-unknown" };
  // Есть несохранённые правки — сперва коммит (кнопка Commit ядра bb).
  if (input.hasUncommittedChanges) return { visible: false, reason: "dirty" };
  // Нечего пиарить — ветка не ушла вперёд базовой.
  if (input.aheadCount <= 0) return { visible: false, reason: "nothing-to-pr" };
  return { visible: true, reason: "ready" };
}
