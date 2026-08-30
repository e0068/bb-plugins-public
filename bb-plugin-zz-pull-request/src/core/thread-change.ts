// Слой 1 — решение, стоит ли по событию `thread:changed` просить фронт
// перечитать состояние PR. Ноль эффектов.
//
// PR в bb — свойство окружения (`environments.pullRequest`); треду он виден
// через связку thread→environment. Значит из потока изменений треда состояние
// PR может задеть ровно одна разновидность — смена этой связки. Остальные виды
// (статус, заголовок, чтение, пин, очередь…) к PR отношения не имеют, и рефетч
// по ним гонялся бы впустую на каждом хартбите активного треда.

/** Вид изменения треда, после которого связка с окружением/PR могла смениться. */
const ENVIRONMENT_LINK_CHANGE = "environment-changed";

export function threadChangeTouchesPr(changes: readonly string[]): boolean {
  return changes.includes(ENVIRONMENT_LINK_CHANGE);
}
