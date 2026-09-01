// Слой 1 — решение, показывать ли кнопку «Fast Forward» (догнать базовую ветку).
// Ноль эффектов.
//
// Перемотка нужна ровно когда ветку МОЖНО перемотать без слияния: она отстала
// от базы (behind > 0) и не имеет своих коммитов впереди (ahead = 0). Свои
// коммиты впереди означают расхождение — тогда это уже merge/rebase, а не
// fast-forward, и кнопку прячем. Несохранённые правки тоже прячут: ff-merge на
// грязном дереве упирается в незакоммиченное.

export interface FastForwardInput {
  behindCount: number;
  aheadCount: number;
  hasUncommittedChanges: boolean;
}

/** Причина скрыта наружу — по ней фронт может подсказать пользователю. */
export type FastForwardReason = "ready" | "up-to-date" | "diverged" | "dirty";

export interface FastForwardDecision {
  visible: boolean;
  reason: FastForwardReason;
}

export function decideFastForward(input: FastForwardInput): FastForwardDecision {
  // Грязное дерево — ff-merge упрётся в незакоммиченное; сперва коммит.
  if (input.hasUncommittedChanges) return { visible: false, reason: "dirty" };
  // Не отстаём — перематывать нечего.
  if (input.behindCount <= 0) return { visible: false, reason: "up-to-date" };
  // Есть свои коммиты впереди — ветки разошлись, чистый fast-forward невозможен.
  if (input.aheadCount > 0) return { visible: false, reason: "diverged" };
  return { visible: true, reason: "ready" };
}
